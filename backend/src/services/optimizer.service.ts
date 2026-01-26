import { PrismaClient, Driver, Vehicle, Trailer, Location, Schedule, TripType } from '@prisma/client';
import { validateSingleTrip, ADR_LIMITS } from './adrValidator.service.js';

// ============================================================================
// TIPI E COSTANTI
// ============================================================================

interface OptimizationResult {
  success: boolean;
  trips: GeneratedTrip[];
  warnings: string[];
  statistics: {
    totalTrips: number;
    totalLiters: number;
    totalDrivingHours: number;
    trailersAtParking: number;
    unmetLiters: number;
    tripsByType: {
      SHUTTLE_LIVIGNO: number;
      SUPPLY_MILANO: number;
      FULL_ROUND: number;
    };
  };
}

interface GeneratedTrip {
  date: Date;
  departureTime: Date;
  returnTime: Date;
  vehicleId: string;
  driverId: string;
  tripType: TripType;
  trailers: {
    trailerId: string;
    litersLoaded: number;
    dropOffLocationId?: string;
    isPickup: boolean;
  }[];
}

// Durate viaggi in minuti
const TRIP_DURATIONS = {
  SHUTTLE_LIVIGNO: 210,  // 90 (andata) + 90 (ritorno) + 30 (scarico) = 3.5h
  SUPPLY_MILANO: 360,    // 150 (andata) + 150 (ritorno) + 60 (carico) = 6h
  FULL_ROUND: 480,       // 8h completo
};

// Litri consegnati per tipo viaggio
const TRIP_LITERS = {
  SHUTTLE_LIVIGNO: 17500,  // 1 cisterna a Livigno
  SUPPLY_MILANO: 0,        // Non consegna, riempie deposito Tirano
  FULL_ROUND: 17500,       // 1 cisterna a Livigno
};

// Cisterne utilizzate per tipo viaggio
const TRIP_TRAILERS = {
  SHUTTLE_LIVIGNO: 1,  // Max 1 su strada montagna
  SUPPLY_MILANO: 2,    // Può portare 2 cisterne vuote, torna con 2 piene
  FULL_ROUND: 1,       // 1 cisterna tutto il percorso
};

const LITERS_PER_TRAILER = 17500;
const DEFAULT_DEPARTURE_HOUR = 6;
const MAX_DAILY_HOURS = 9; // ADR limit
const MAX_SHUTTLE_PER_DAY_LIVIGNO_DRIVER = 3;

// ============================================================================
// STATO CISTERNE
// ============================================================================

interface CisternState {
  atTiranoFull: Set<string>;   // ID cisterne piene a Tirano
  atTiranoEmpty: Set<string>;  // ID cisterne vuote a Tirano
  atMilano: Set<string>;       // ID cisterne a Milano (sorgente)
  inTransit: Set<string>;      // ID cisterne in viaggio
}

// ============================================================================
// TRACKER DISPONIBILITÀ
// ============================================================================

interface AvailabilityTracker {
  driverHoursByDate: Map<string, number>;
  driverHoursByWeek: Map<string, number>;
  driverShuttleCountByDate: Map<string, number>; // Per driver Livigno
  vehicleSchedule: Map<string, Date[]>;
  cisternState: CisternState;
}

// ============================================================================
// FUNZIONE PRINCIPALE
// ============================================================================

export async function optimizeSchedule(
  prisma: PrismaClient,
  scheduleId: string
): Promise<OptimizationResult> {
  const warnings: string[] = [];

  // Fetch schedule with initial states
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      initialStates: {
        include: {
          location: true,
        },
      },
    },
  });

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  // Fetch available resources
  const [drivers, vehicles, trailers, locations] = await Promise.all([
    prisma.driver.findMany({
      where: { isActive: true },
      include: { baseLocation: true },
    }),
    prisma.vehicle.findMany({ where: { isActive: true } }),
    prisma.trailer.findMany({ where: { isActive: true } }),
    prisma.location.findMany({ where: { isActive: true } }),
  ]);

  if (drivers.length === 0) throw new Error('No active drivers available');
  if (vehicles.length === 0) throw new Error('No active vehicles available');
  if (trailers.length === 0) throw new Error('No active trailers available');

  // Find key locations
  const tiranoLocation = locations.find((l) => l.type === 'PARKING');
  const milanoLocation = locations.find((l) => l.type === 'SOURCE');
  const livignoLocation = locations.find((l) => l.type === 'DESTINATION');

  if (!tiranoLocation || !milanoLocation || !livignoLocation) {
    throw new Error('Missing required locations (Milano, Tirano, Livigno)');
  }

  // Categorize drivers by base
  const livignoDrivers = drivers.filter(d => d.baseLocationId === livignoLocation.id);
  const tiranoDrivers = drivers.filter(d => d.baseLocationId === tiranoLocation.id || !d.baseLocationId);

  // Initialize availability tracker
  const tracker: AvailabilityTracker = {
    driverHoursByDate: new Map(),
    driverHoursByWeek: new Map(),
    driverShuttleCountByDate: new Map(),
    vehicleSchedule: new Map(),
    cisternState: {
      atTiranoFull: new Set(),
      atTiranoEmpty: new Set(),
      atMilano: new Set(),
      inTransit: new Set(),
    },
  };

  // Initialize cistern state from schedule initial states or default to Tirano empty
  for (const trailer of trailers) {
    const initialState = schedule.initialStates.find(s => s.trailerId === trailer.id);

    if (initialState) {
      if (initialState.location.type === 'SOURCE') {
        // A Milano
        tracker.cisternState.atMilano.add(trailer.id);
      } else if (initialState.location.type === 'PARKING') {
        // A Tirano
        if (initialState.isFull) {
          tracker.cisternState.atTiranoFull.add(trailer.id);
        } else {
          tracker.cisternState.atTiranoEmpty.add(trailer.id);
        }
      }
    } else {
      // Default: cisterne a Tirano vuote
      tracker.cisternState.atTiranoEmpty.add(trailer.id);
    }
  }

  // Fetch existing work logs
  const existingLogs = await prisma.driverWorkLog.findMany({
    where: {
      date: {
        gte: schedule.startDate,
        lte: schedule.endDate,
      },
    },
  });

  for (const log of existingLogs) {
    const dateKey = log.date.toISOString().split('T')[0];
    const weekKey = `${log.driverId}-${log.weekNumber}`;
    const driverDateKey = `${log.driverId}-${dateKey}`;

    tracker.driverHoursByDate.set(
      driverDateKey,
      (tracker.driverHoursByDate.get(driverDateKey) || 0) + log.drivingHours
    );
    tracker.driverHoursByWeek.set(
      weekKey,
      (tracker.driverHoursByWeek.get(weekKey) || 0) + log.drivingHours
    );
  }

  // Get working days
  const workingDays = getWorkingDays(schedule.startDate, schedule.endDate);
  if (workingDays.length === 0) {
    throw new Error('No working days in schedule period');
  }

  const generatedTrips: GeneratedTrip[] = [];
  let remainingLiters = schedule.requiredLiters;
  const tripsByType = { SHUTTLE_LIVIGNO: 0, SUPPLY_MILANO: 0, FULL_ROUND: 0 };

  // ============================================================================
  // ALGORITMO DI OTTIMIZZAZIONE
  // ============================================================================

  for (const currentDay of workingDays) {
    if (remainingLiters <= 0) break;

    const dateKey = currentDay.toISOString().split('T')[0];

    // --------------------------------------------------------------------
    // FASE 1: DRIVER LIVIGNO (priorità massima - shuttle efficienti)
    // --------------------------------------------------------------------
    for (const driver of livignoDrivers) {
      if (remainingLiters <= 0) break;

      const shuttleKey = `${driver.id}-${dateKey}`;
      let shuttleCount = tracker.driverShuttleCountByDate.get(shuttleKey) || 0;

      while (shuttleCount < MAX_SHUTTLE_PER_DAY_LIVIGNO_DRIVER && remainingLiters > 0) {
        // Check if we have full cisterns at Tirano
        if (tracker.cisternState.atTiranoFull.size === 0) {
          // Need supply first
          break;
        }

        // Check driver availability
        const driverDateKey = `${driver.id}-${dateKey}`;
        const currentHours = tracker.driverHoursByDate.get(driverDateKey) || 0;
        const tripHours = TRIP_DURATIONS.SHUTTLE_LIVIGNO / 60;

        if (currentHours + tripHours > MAX_DAILY_HOURS) break;

        // Find available vehicle
        const vehicle = findAvailableVehicle(vehicles, currentDay, tracker);
        if (!vehicle) break;

        // Get a full cistern from Tirano
        const cisternId = tracker.cisternState.atTiranoFull.values().next().value;
        if (!cisternId) break;

        // Calculate times
        const departureHour = DEFAULT_DEPARTURE_HOUR + (shuttleCount * 3.5);
        const departureTime = new Date(currentDay);
        departureTime.setHours(Math.floor(departureHour), (departureHour % 1) * 60, 0, 0);

        const returnTime = new Date(departureTime);
        returnTime.setMinutes(returnTime.getMinutes() + TRIP_DURATIONS.SHUTTLE_LIVIGNO);

        // Create trip
        generatedTrips.push({
          date: currentDay,
          departureTime,
          returnTime,
          vehicleId: vehicle.id,
          driverId: driver.id,
          tripType: 'SHUTTLE_LIVIGNO',
          trailers: [{
            trailerId: cisternId,
            litersLoaded: LITERS_PER_TRAILER,
            isPickup: true, // Prende da Tirano
          }],
        });

        // Update state
        tracker.cisternState.atTiranoFull.delete(cisternId);
        tracker.cisternState.atTiranoEmpty.add(cisternId); // Dopo scarico a Livigno, torna vuota a Tirano

        tracker.driverHoursByDate.set(driverDateKey, currentHours + tripHours);
        tracker.driverShuttleCountByDate.set(shuttleKey, shuttleCount + 1);

        const vehicleSchedule = tracker.vehicleSchedule.get(vehicle.id) || [];
        vehicleSchedule.push(currentDay);
        tracker.vehicleSchedule.set(vehicle.id, vehicleSchedule);

        remainingLiters -= TRIP_LITERS.SHUTTLE_LIVIGNO;
        tripsByType.SHUTTLE_LIVIGNO++;
        shuttleCount++;
      }
    }

    // --------------------------------------------------------------------
    // FASE 2: DRIVER TIRANO - Bilancio SUPPLY vs SHUTTLE
    // --------------------------------------------------------------------
    for (const driver of tiranoDrivers) {
      if (remainingLiters <= 0) break;

      const driverDateKey = `${driver.id}-${dateKey}`;
      const currentHours = tracker.driverHoursByDate.get(driverDateKey) || 0;

      // Skip emergency drivers unless needed
      if (driver.type === 'EMERGENCY') continue;

      // Decide trip type based on cistern state
      const fullCisternsAtTirano = tracker.cisternState.atTiranoFull.size;
      const emptyCisternsAtTirano = tracker.cisternState.atTiranoEmpty.size;

      let tripType: TripType;
      let tripHours: number;

      if (fullCisternsAtTirano < 2 && emptyCisternsAtTirano >= 2) {
        // Need to refill Tirano - do SUPPLY trip
        tripType = 'SUPPLY_MILANO';
        tripHours = TRIP_DURATIONS.SUPPLY_MILANO / 60;
      } else if (fullCisternsAtTirano >= 1) {
        // Can do shuttle from Tirano
        tripType = 'SHUTTLE_LIVIGNO';
        tripHours = TRIP_DURATIONS.SHUTTLE_LIVIGNO / 60;
      } else {
        // Fallback to full round trip
        tripType = 'FULL_ROUND';
        tripHours = TRIP_DURATIONS.FULL_ROUND / 60;
      }

      // Check if driver can do this trip
      if (currentHours + tripHours > MAX_DAILY_HOURS) continue;

      // Find available vehicle
      const vehicle = findAvailableVehicle(vehicles, currentDay, tracker);
      if (!vehicle) continue;

      // Calculate times
      const departureTime = new Date(currentDay);
      departureTime.setHours(DEFAULT_DEPARTURE_HOUR, 0, 0, 0);

      const returnTime = new Date(departureTime);
      returnTime.setMinutes(returnTime.getMinutes() + (tripHours * 60));

      // Create trip based on type
      let tripTrailers: GeneratedTrip['trailers'] = [];

      if (tripType === 'SUPPLY_MILANO') {
        // Take 2 empty cisterns to Milano, return with 2 full
        const emptyIds = Array.from(tracker.cisternState.atTiranoEmpty).slice(0, 2);
        if (emptyIds.length < 2) continue;

        tripTrailers = emptyIds.map(id => ({
          trailerId: id,
          litersLoaded: LITERS_PER_TRAILER,
          isPickup: false,
          dropOffLocationId: tiranoLocation.id, // Leave full at Tirano
        }));

        // Update cistern state
        emptyIds.forEach(id => {
          tracker.cisternState.atTiranoEmpty.delete(id);
          tracker.cisternState.atTiranoFull.add(id);
        });

        tripsByType.SUPPLY_MILANO++;
        // SUPPLY doesn't deliver to Livigno, just fills Tirano
      } else if (tripType === 'SHUTTLE_LIVIGNO') {
        // Take 1 full cistern from Tirano to Livigno
        const cisternId = tracker.cisternState.atTiranoFull.values().next().value;
        if (!cisternId) continue;

        tripTrailers = [{
          trailerId: cisternId,
          litersLoaded: LITERS_PER_TRAILER,
          isPickup: true,
        }];

        tracker.cisternState.atTiranoFull.delete(cisternId);
        tracker.cisternState.atTiranoEmpty.add(cisternId);

        remainingLiters -= TRIP_LITERS.SHUTTLE_LIVIGNO;
        tripsByType.SHUTTLE_LIVIGNO++;
      } else {
        // FULL_ROUND: Takes empty from Tirano, fills at Milano, delivers to Livigno
        const cisternId = tracker.cisternState.atTiranoEmpty.values().next().value
          || tracker.cisternState.atMilano.values().next().value;
        if (!cisternId) continue;

        tripTrailers = [{
          trailerId: cisternId,
          litersLoaded: LITERS_PER_TRAILER,
          isPickup: tracker.cisternState.atTiranoEmpty.has(cisternId),
        }];

        // After full round, cistern returns empty to Tirano
        tracker.cisternState.atTiranoEmpty.delete(cisternId);
        tracker.cisternState.atMilano.delete(cisternId);
        tracker.cisternState.atTiranoEmpty.add(cisternId);

        remainingLiters -= TRIP_LITERS.FULL_ROUND;
        tripsByType.FULL_ROUND++;
      }

      generatedTrips.push({
        date: currentDay,
        departureTime,
        returnTime,
        vehicleId: vehicle.id,
        driverId: driver.id,
        tripType,
        trailers: tripTrailers,
      });

      // Update tracker
      tracker.driverHoursByDate.set(driverDateKey, currentHours + tripHours);

      const weekNum = getWeekNumber(currentDay);
      const weekKey = `${driver.id}-${weekNum}`;
      tracker.driverHoursByWeek.set(
        weekKey,
        (tracker.driverHoursByWeek.get(weekKey) || 0) + tripHours
      );

      const vehicleSchedule = tracker.vehicleSchedule.get(vehicle.id) || [];
      vehicleSchedule.push(currentDay);
      tracker.vehicleSchedule.set(vehicle.id, vehicleSchedule);
    }
  }

  // Add warnings
  if (remainingLiters > 0) {
    warnings.push(`Litri non coperti: ${remainingLiters.toLocaleString()}L - Servono più giorni o risorse`);
  }

  if (tripsByType.SUPPLY_MILANO === 0 && tripsByType.SHUTTLE_LIVIGNO > 2) {
    warnings.push('Attenzione: nessun viaggio SUPPLY. Le cisterne a Tirano potrebbero esaurirsi.');
  }

  // Save trips to database
  if (generatedTrips.length > 0) {
    await prisma.trip.deleteMany({ where: { scheduleId } });

    for (const trip of generatedTrips) {
      await prisma.trip.create({
        data: {
          scheduleId,
          vehicleId: trip.vehicleId,
          driverId: trip.driverId,
          date: trip.date,
          departureTime: trip.departureTime,
          returnTime: trip.returnTime,
          tripType: trip.tripType,
          status: 'PLANNED',
          trailers: {
            create: trip.trailers.map((t) => ({
              trailerId: t.trailerId,
              litersLoaded: t.litersLoaded,
              dropOffLocationId: t.dropOffLocationId,
              isPickup: t.isPickup,
            })),
          },
        },
      });
    }
  }

  const totalLiters = generatedTrips.reduce(
    (sum, trip) => sum + trip.trailers.reduce((tSum, t) => tSum + t.litersLoaded, 0),
    0
  );

  const trailersAtParking = tracker.cisternState.atTiranoFull.size + tracker.cisternState.atTiranoEmpty.size;

  return {
    success: remainingLiters <= 0,
    trips: generatedTrips,
    warnings,
    statistics: {
      totalTrips: generatedTrips.length,
      totalLiters,
      totalDrivingHours: generatedTrips.reduce((sum, t) => {
        const hours = (t.returnTime.getTime() - t.departureTime.getTime()) / (1000 * 60 * 60);
        return sum + hours;
      }, 0),
      trailersAtParking,
      unmetLiters: Math.max(0, remainingLiters),
      tripsByType,
    },
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function findAvailableVehicle(
  vehicles: Vehicle[],
  date: Date,
  tracker: AvailabilityTracker
): Vehicle | null {
  const dateKey = date.toISOString().split('T')[0];

  for (const vehicle of vehicles) {
    const schedule = tracker.vehicleSchedule.get(vehicle.id) || [];
    const usedToday = schedule.filter(
      (d) => d.toISOString().split('T')[0] === dateKey
    ).length;

    // Allow multiple trips per day per vehicle (realistic)
    if (usedToday < 2) {
      return vehicle;
    }
  }

  return null;
}

function getWorkingDays(startDate: Date, endDate: Date): Date[] {
  const days: Date[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    // Monday (1) to Friday (5)
    if (dayOfWeek >= 1 && dayOfWeek <= 5) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
