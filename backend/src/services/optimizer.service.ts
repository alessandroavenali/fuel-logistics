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

  // Categorize drivers by base and sort by priority (RESIDENT > ON_CALL > EMERGENCY)
  const driverPriority = { RESIDENT: 0, ON_CALL: 1, EMERGENCY: 2 };
  const sortByPriority = (a: typeof drivers[0], b: typeof drivers[0]) =>
    driverPriority[a.type] - driverPriority[b.type];

  const livignoDrivers = drivers
    .filter(d => d.baseLocationId === livignoLocation.id)
    .sort(sortByPriority);

  const tiranoDrivers = drivers
    .filter(d => d.baseLocationId === tiranoLocation.id || !d.baseLocationId)
    .sort(sortByPriority);

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
    // Priorità: RESIDENT prima, ON_CALL solo se RESIDENT esauriti
    // --------------------------------------------------------------------
    for (const driver of tiranoDrivers) {
      if (remainingLiters <= 0) break;

      const driverDateKey = `${driver.id}-${dateKey}`;
      const currentHours = tracker.driverHoursByDate.get(driverDateKey) || 0;

      // Skip emergency drivers unless needed
      if (driver.type === 'EMERGENCY') continue;

      // ON_CALL solo se tutti i RESIDENT hanno già lavorato oggi
      if (driver.type === 'ON_CALL') {
        const residentsAvailable = tiranoDrivers
          .filter(d => d.type === 'RESIDENT')
          .some(d => {
            const hours = tracker.driverHoursByDate.get(`${d.id}-${dateKey}`) || 0;
            return hours < MAX_DAILY_HOURS - 3; // Almeno 3h libere per un viaggio
          });
        if (residentsAvailable) continue; // Skip ON_CALL, ci sono ancora RESIDENT disponibili
      }

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

// ============================================================================
// CALCOLO CAPACITÀ MASSIMA
// ============================================================================

export interface MaxCapacityResult {
  maxLiters: number;
  workingDays: number;
  breakdown: {
    livignoDriverShuttles: number;
    tiranoDriverShuttles: number;
    tiranoDriverFullRounds: number;
    supplyTrips: number;
  };
  dailyCapacity: number;
  constraints: string[];
}

export interface CalculateMaxInput {
  startDate: string | Date;
  endDate: string | Date;
  initialStates?: {
    trailerId: string;
    locationId: string;
    isFull: boolean;
  }[];
}

export async function calculateMaxCapacity(
  prisma: PrismaClient,
  input: CalculateMaxInput
): Promise<MaxCapacityResult> {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);

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

  // Find key locations
  const tiranoLocation = locations.find((l) => l.type === 'PARKING');
  const livignoLocation = locations.find((l) => l.type === 'DESTINATION');

  if (!tiranoLocation || !livignoLocation) {
    throw new Error('Missing required locations');
  }

  // Categorize drivers
  const livignoDrivers = drivers.filter(
    (d) => d.baseLocationId === livignoLocation.id && d.type !== 'EMERGENCY'
  );
  const tiranoDrivers = drivers.filter(
    (d) =>
      (d.baseLocationId === tiranoLocation.id || !d.baseLocationId) &&
      d.type !== 'EMERGENCY'
  );

  // Get working days
  const workingDays = getWorkingDays(startDate, endDate);
  const numWorkingDays = workingDays.length;

  if (numWorkingDays === 0) {
    return {
      maxLiters: 0,
      workingDays: 0,
      breakdown: {
        livignoDriverShuttles: 0,
        tiranoDriverShuttles: 0,
        tiranoDriverFullRounds: 0,
        supplyTrips: 0,
      },
      dailyCapacity: 0,
      constraints: ['Nessun giorno lavorativo nel periodo selezionato'],
    };
  }

  const constraints: string[] = [];

  // Calculate initial cistern state
  let fullCisternsAtTirano = 0;
  let emptyCisternsAtTirano = 0;

  if (input.initialStates && input.initialStates.length > 0) {
    for (const state of input.initialStates) {
      const location = locations.find((l) => l.id === state.locationId);
      if (location?.type === 'PARKING') {
        if (state.isFull) {
          fullCisternsAtTirano++;
        } else {
          emptyCisternsAtTirano++;
        }
      }
    }
  } else {
    // Default: all trailers empty at Tirano
    emptyCisternsAtTirano = trailers.length;
  }

  // =========================================================================
  // CALCOLO CAPACITÀ MASSIMA TEORICA
  // =========================================================================

  // Driver Livigno: max 3 shuttle/giorno ciascuno (9h / 3.5h ≈ 2.5, arrotondato a 3)
  const shuttlesPerLivignoDriverPerDay = MAX_SHUTTLE_PER_DAY_LIVIGNO_DRIVER;
  const dailyLivignoShuttles = livignoDrivers.length * shuttlesPerLivignoDriverPerDay;
  const livignoLitersPerDay = dailyLivignoShuttles * LITERS_PER_TRAILER;

  // Driver Tirano: calcoliamo quanti viaggi possono fare
  // Ogni driver Tirano può fare:
  // - 2 SHUTTLE (3.5h × 2 = 7h) oppure
  // - 1 SUPPLY (6h) + 1 SHUTTLE (3.5h) se necessario per rifornimento
  // - 1 FULL_ROUND (8h) se non ci sono cisterne piene

  // Strategia ottimale: 1 driver fa SUPPLY, altri fanno SHUTTLE
  const numTiranoDriversForSupply = Math.min(1, tiranoDrivers.length); // 1 driver dedicato al rifornimento
  const numTiranoDriversForDelivery = tiranoDrivers.length - numTiranoDriversForSupply;

  // Ogni driver dedicato alla consegna può fare circa 2 shuttle al giorno
  const shuttlesPerTiranoDriverPerDay = Math.floor(MAX_DAILY_HOURS / (TRIP_DURATIONS.SHUTTLE_LIVIGNO / 60));
  const dailyTiranoShuttles = numTiranoDriversForDelivery * shuttlesPerTiranoDriverPerDay;
  const tiranoLitersPerDay = dailyTiranoShuttles * LITERS_PER_TRAILER;

  // Il driver SUPPLY riempie 2 cisterne per viaggio, può fare 1 SUPPLY al giorno
  // Questo non consegna direttamente ma abilita gli shuttle
  const supplyTripsPerDay = numTiranoDriversForSupply;

  // Vincolo cisterne: servono cisterne piene per fare shuttle
  // Con 8 cisterne e 1 SUPPLY che riempie 2 cisterne/giorno = 2 cicli possibili
  // Ma i Livigno driver consumano cisterne piene velocemente

  // Calcolo vincolo cisterne
  const totalDailyShuttles = dailyLivignoShuttles + dailyTiranoShuttles;
  const cisternsNeededPerDay = totalDailyShuttles; // Ogni shuttle usa 1 cisterna
  const cisternsRefilledPerDay = supplyTripsPerDay * TRIP_TRAILERS.SUPPLY_MILANO; // SUPPLY riempie 2 cisterne

  // Se le cisterne consumate > cisterne riempite, siamo limitati dalle cisterne
  let effectiveDailyCapacity: number;
  let actualDailyShuttles: number;

  if (cisternsNeededPerDay > cisternsRefilledPerDay + fullCisternsAtTirano) {
    // Limitati dalle cisterne: consideriamo il flusso stazionario
    // Cisterne disponibili = iniziali piene + riempite giornalmente
    // Ma le cisterne tornano vuote dopo consegna, quindi il limite è il ciclo di rifornimento

    // In stato stazionario: shuttle/giorno = min(driver capacity, cisterne riempite + iniziali per primo giorno)
    actualDailyShuttles = Math.min(totalDailyShuttles, cisternsRefilledPerDay + (fullCisternsAtTirano / numWorkingDays));
    effectiveDailyCapacity = actualDailyShuttles * LITERS_PER_TRAILER;

    constraints.push(
      `Capacità limitata dal ciclo cisterne: ${cisternsRefilledPerDay} cisterne riempite/giorno vs ${totalDailyShuttles} shuttle possibili`
    );
  } else {
    actualDailyShuttles = totalDailyShuttles;
    effectiveDailyCapacity = (livignoLitersPerDay + tiranoLitersPerDay);
  }

  // Vincolo veicoli: ogni veicolo può fare max 2 viaggi/giorno
  const vehicleCapacity = vehicles.length * 2; // viaggi/giorno
  if (actualDailyShuttles > vehicleCapacity) {
    actualDailyShuttles = vehicleCapacity;
    effectiveDailyCapacity = actualDailyShuttles * LITERS_PER_TRAILER;
    constraints.push(
      `Capacità limitata dai veicoli: ${vehicles.length} veicoli × 2 viaggi = ${vehicleCapacity} viaggi/giorno`
    );
  }

  // Calcolo finale
  const maxLiters = Math.floor(effectiveDailyCapacity * numWorkingDays);

  // Breakdown stimato
  const breakdown = {
    livignoDriverShuttles: Math.round(dailyLivignoShuttles * numWorkingDays * (actualDailyShuttles / totalDailyShuttles || 1)),
    tiranoDriverShuttles: Math.round(dailyTiranoShuttles * numWorkingDays * (actualDailyShuttles / totalDailyShuttles || 1)),
    tiranoDriverFullRounds: 0, // In scenario ottimale non servono
    supplyTrips: supplyTripsPerDay * numWorkingDays,
  };

  // Aggiungi info sui driver
  if (livignoDrivers.length === 0) {
    constraints.push('Nessun driver con base Livigno disponibile');
  }
  if (tiranoDrivers.length === 0) {
    constraints.push('Nessun driver con base Tirano disponibile');
  }
  if (vehicles.length < 4) {
    constraints.push(`Solo ${vehicles.length} veicoli disponibili (ottimale: 4)`);
  }
  if (trailers.length < 8) {
    constraints.push(`Solo ${trailers.length} cisterne disponibili (ottimale: 8)`);
  }

  return {
    maxLiters,
    workingDays: numWorkingDays,
    breakdown,
    dailyCapacity: Math.floor(effectiveDailyCapacity),
    constraints,
  };
}
