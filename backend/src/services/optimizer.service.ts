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
  atLivignoFull: Set<string>;  // ID cisterne piene a Livigno
  atLivignoEmpty: Set<string>; // ID cisterne vuote a Livigno
  atMilano: Set<string>;       // ID cisterne a Milano (sorgente)
  inTransit: Set<string>;      // ID cisterne in viaggio
}

// ============================================================================
// TRACKER DISPONIBILITÀ
// ============================================================================

interface TimeSlot {
  start: Date;
  end: Date;
  driverId: string;
}

interface AvailabilityTracker {
  driverHoursByDate: Map<string, number>;
  driverHoursByWeek: Map<string, number>;
  driverShuttleCountByDate: Map<string, number>; // Per driver Livigno
  vehicleTimeSlots: Map<string, TimeSlot[]>; // vehicleId -> array di slot occupati
  trailerTimeSlots: Map<string, TimeSlot[]>; // trailerId -> array di slot occupati
  cisternState: CisternState;
}

// ============================================================================
// FUNZIONE PRINCIPALE
// ============================================================================

export async function optimizeSchedule(
  prisma: PrismaClient,
  scheduleId: string,
  driverAvailability?: DriverAvailabilityInput[]
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
    prisma.vehicle.findMany({
      where: { isActive: true },
      include: { baseLocation: true },
    }),
    prisma.trailer.findMany({
      where: { isActive: true },
      include: { baseLocation: true },
    }),
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
    vehicleTimeSlots: new Map(),
    trailerTimeSlots: new Map(),
    cisternState: {
      atTiranoFull: new Set(),
      atTiranoEmpty: new Set(),
      atLivignoFull: new Set(),
      atLivignoEmpty: new Set(),
      atMilano: new Set(),
      inTransit: new Set(),
    },
  };

  // Initialize cistern state from schedule initial states or default based on baseLocation
  for (const trailer of trailers) {
    const initialState = schedule.initialStates.find(s => s.trailerId === trailer.id);

    if (initialState) {
      // Usa lo stato iniziale esplicito dello schedule
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
      } else if (initialState.location.type === 'DESTINATION') {
        // A Livigno
        if (initialState.isFull) {
          tracker.cisternState.atLivignoFull.add(trailer.id);
        } else {
          tracker.cisternState.atLivignoEmpty.add(trailer.id);
        }
      }
    } else {
      // Default: usa baseLocation della cisterna (vuota)
      // Se ha base Livigno -> a Livigno vuota
      // Altrimenti (Tirano o non specificata) -> a Tirano vuota
      if (trailer.baseLocation?.type === 'DESTINATION') {
        tracker.cisternState.atLivignoEmpty.add(trailer.id);
      } else {
        tracker.cisternState.atTiranoEmpty.add(trailer.id);
      }
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

  // Get working days (use schedule.includeWeekend flag)
  const workingDays = getWorkingDays(schedule.startDate, schedule.endDate, schedule.includeWeekend);
  if (workingDays.length === 0) {
    throw new Error('No working days in schedule period');
  }

  const generatedTrips: GeneratedTrip[] = [];
  let remainingLiters = schedule.requiredLiters;
  const tripsByType = { SHUTTLE_LIVIGNO: 0, SUPPLY_MILANO: 0, FULL_ROUND: 0 };

  // ============================================================================
  // ALGORITMO DI OTTIMIZZAZIONE - MASSIMIZZA LITRI CONSEGNATI A LIVIGNO
  // ============================================================================
  // Simulazione temporale: traccia quando le cisterne diventano disponibili
  // I driver lavorano fino al limite ADR (9h, o 10h max 2x/settimana)

  for (const currentDay of workingDays) {
    if (remainingLiters <= 0) break;

    const dateKey = currentDay.toISOString().split('T')[0];
    const weekNum = getWeekNumber(currentDay);

    // Track state for this day
    const driverState = new Map<string, {
      nextAvailable: Date;
      hoursWorked: number;
      extendedDaysThisWeek: number;
    }>();

    // Initialize driver states
    for (const d of drivers) {
      const startOfDay = new Date(currentDay);
      startOfDay.setHours(DEFAULT_DEPARTURE_HOUR, 0, 0, 0);

      // Check how many extended days this driver has used this week
      const weekKey = `${d.id}-${weekNum}`;
      const extendedDays = tracker.driverHoursByWeek.get(`${weekKey}-extended`) || 0;

      driverState.set(d.id, {
        nextAvailable: startOfDay,
        hoursWorked: tracker.driverHoursByDate.get(`${d.id}-${dateKey}`) || 0,
        extendedDaysThisWeek: extendedDays,
      });
    }

    // Track when cisterns become available (after SUPPLY returns)
    // Key: cisternId, Value: time when it becomes full at Tirano
    const cisternAvailableAt = new Map<string, Date>();

    // End of work day
    const endOfWorkDay = new Date(currentDay);
    endOfWorkDay.setHours(22, 0, 0, 0);

    // =========================================================================
    // ALGORITMO A DUE FASI:
    // 1. SUPPLY al mattino: tutti i driver Tirano disponibili fanno SUPPLY
    // 2. SHUTTLE nel pomeriggio: tutti fanno SHUTTLE (Livigno ha priorità)
    //
    // L'obiettivo è massimizzare gli SHUTTLE paralleli usando tutte le
    // cisterne piene disponibili.
    // =========================================================================

    // Filtra driver disponibili oggi
    // Logica:
    // - Se il driver è nella lista driverAvailability → usa quelle date
    // - Se NON è nella lista:
    //   - RESIDENT → disponibile tutti i giorni (default)
    //   - ON_CALL → NON disponibile (deve essere esplicitamente attivato)
    //   - EMERGENCY → NON disponibile (deve essere esplicitamente attivato)
    //
    // IMPORTANTE: Questo comportamento è allineato con il frontend che di default:
    // - Seleziona tutti i giorni per RESIDENT
    // - Non seleziona nessun giorno per ON_CALL e EMERGENCY
    const availableDriversToday = [...drivers]
      .filter(d => {
        if (driverAvailability && driverAvailability.length > 0) {
          const availability = driverAvailability.find(a => a.driverId === d.id);
          if (availability) {
            // Driver nella lista: usa le date specificate
            return availability.availableDates.includes(dateKey);
          } else {
            // Driver NON nella lista: usa default per tipo
            // RESIDENT = sempre disponibile, ON_CALL/EMERGENCY = mai
            return d.type === 'RESIDENT';
          }
        }
        // Nessuna lista specificata (comportamento default):
        // Solo RESIDENT, escludi ON_CALL e EMERGENCY
        return d.type === 'RESIDENT';
      });

    const livignoDriversToday = availableDriversToday.filter(
      d => d.baseLocationId === livignoLocation.id
    );
    const tiranoDriversToday = availableDriversToday.filter(
      d => d.baseLocationId !== livignoLocation.id
    );

    // Keep scheduling until no more trips possible
    let madeProgress = true;
    let iterations = 0;
    const maxIterations = 100;

    while (madeProgress && remainingLiters > 0 && iterations < maxIterations) {
      madeProgress = false;
      iterations++;

      // Conta risorse disponibili ORA
      const emptyCisternsAtTirano = tracker.cisternState.atTiranoEmpty.size;
      const emptyCisternsAtLivigno = tracker.cisternState.atLivignoEmpty.size;
      const totalEmptyCisterns = emptyCisternsAtTirano + emptyCisternsAtLivigno;

      // Trova il prossimo driver libero
      const sortedDrivers = availableDriversToday
        .map(d => ({ driver: d, state: driverState.get(d.id)! }))
        .filter(({ state }) => state && state.nextAvailable < endOfWorkDay)
        .sort((a, b) => {
          // Ordina per tempo disponibile
          const timeDiff = a.state.nextAvailable.getTime() - b.state.nextAvailable.getTime();
          if (Math.abs(timeDiff) > 60000) return timeDiff; // >1 min di differenza

          // A parità di tempo, priorità ai driver Livigno per SHUTTLE
          const aIsLivigno = a.driver.baseLocationId === livignoLocation.id;
          const bIsLivigno = b.driver.baseLocationId === livignoLocation.id;
          if (aIsLivigno && !bIsLivigno) return -1;
          if (!aIsLivigno && bIsLivigno) return 1;
          return 0;
        });

      for (const { driver, state } of sortedDrivers) {
        if (remainingLiters <= 0) break;

        const isLivignoDriver = driver.baseLocationId === livignoLocation.id;
        const availableTime = state.nextAvailable;

        // Max ore oggi (9h o 10h con estensione)
        let maxHoursToday = MAX_DAILY_HOURS;
        if (state.extendedDaysThisWeek < 2) {
          maxHoursToday = 10;
        }

        // Conta cisterne piene disponibili al momento in cui il driver è libero
        let fullCisternsAvailable = tracker.cisternState.atTiranoFull.size;
        let pendingFullCisterns: { id: string; availableAt: Date }[] = [];

        for (const [cisternId, availAt] of cisternAvailableAt) {
          if (availAt <= availableTime) {
            fullCisternsAvailable++;
          } else {
            pendingFullCisterns.push({ id: cisternId, availableAt: availAt });
          }
        }

        let tripType: TripType | null = null;
        let tripDurationMinutes: number = 0;
        let waitUntil: Date | null = null;

        if (isLivignoDriver) {
          // =================================================================
          // DRIVER LIVIGNO: SOLO SHUTTLE!
          // È il più efficiente (può fare 3/giorno), non deve sprecare tempo
          // =================================================================
          if (fullCisternsAvailable > 0) {
            tripType = 'SHUTTLE_LIVIGNO';
            tripDurationMinutes = TRIP_DURATIONS.SHUTTLE_LIVIGNO;
          } else if (pendingFullCisterns.length > 0) {
            // Aspetta le cisterne in arrivo
            const nextCistern = pendingFullCisterns.sort((a, b) =>
              a.availableAt.getTime() - b.availableAt.getTime()
            )[0];
            waitUntil = nextCistern.availableAt;
          }
        } else {
          // =================================================================
          // DRIVER TIRANO: SUPPLY o SHUTTLE
          //
          // Strategia semplice e robusta:
          // 1. Se può fare SUPPLY+SHUTTLE (ore rimanenti) e poche cisterne piene → SUPPLY
          // 2. Se ci sono cisterne piene → SHUTTLE
          // 3. Se ci sono SUPPLY in arrivo → aspetta
          // =================================================================

          const hoursUntilEndOfDay = (endOfWorkDay.getTime() - availableTime.getTime()) / (1000 * 60 * 60);
          // Ore che il driver può ANCORA lavorare oggi (considerando già lavorate)
          const hoursRemaining = maxHoursToday - state.hoursWorked;
          // Può fare SUPPLY (6h) + SHUTTLE (3.5h)?
          const canDoSupplyAndShuttle = hoursRemaining >= 9.5 && hoursUntilEndOfDay >= 9.5;

          // Quante cisterne piene (o in arrivo) abbiamo?
          const totalFullExpected = fullCisternsAvailable + pendingFullCisterns.length;

          // Strategia: fai SUPPLY al mattino se:
          // 1. Può ancora fare SUPPLY + SHUTTLE
          // 2. Ci sono cisterne vuote
          // 3. Poche cisterne piene (ne servono di più)
          const shouldDoSupply = canDoSupplyAndShuttle &&
                                  totalEmptyCisterns >= 2 &&
                                  totalFullExpected < 4;

          // Quanti SUPPLY sono già in corso?
          const suppliesInProgress = Math.floor(pendingFullCisterns.length / 2);

          if (shouldDoSupply) {
            // Priorità 1: SUPPLY al mattino quando può fare anche SHUTTLE dopo
            tripType = 'SUPPLY_MILANO';
            tripDurationMinutes = TRIP_DURATIONS.SUPPLY_MILANO;
          } else if (fullCisternsAvailable >= 1) {
            // Priorità 2: SHUTTLE se ci sono cisterne piene
            tripType = 'SHUTTLE_LIVIGNO';
            tripDurationMinutes = TRIP_DURATIONS.SHUTTLE_LIVIGNO;
          } else if (totalEmptyCisterns >= 2 && hoursRemaining >= 6 && hoursUntilEndOfDay >= 6 && suppliesInProgress < 2) {
            // Priorità 3: SUPPLY anche se non c'è tempo per SHUTTLE dopo
            // MA solo se non ci sono già 2 SUPPLY in corso (evita accumulo eccessivo)
            tripType = 'SUPPLY_MILANO';
            tripDurationMinutes = TRIP_DURATIONS.SUPPLY_MILANO;
          } else if (pendingFullCisterns.length > 0) {
            // Priorità 4: Aspetta SUPPLY in arrivo
            const nextCistern = pendingFullCisterns.sort((a, b) =>
              a.availableAt.getTime() - b.availableAt.getTime()
            )[0];
            waitUntil = nextCistern.availableAt;
          } else if (totalEmptyCisterns > 0 || tracker.cisternState.atMilano.size > 0) {
            // Ultimo fallback: FULL_ROUND
            tripType = 'FULL_ROUND';
            tripDurationMinutes = TRIP_DURATIONS.FULL_ROUND;
          }
        }

        // If waiting, update driver's next available time and continue
        if (waitUntil && !tripType) {
          if (waitUntil < endOfWorkDay) {
            state.nextAvailable = waitUntil;
            madeProgress = true;
          }
          continue;
        }

        if (!tripType) continue;

        const tripHours = tripDurationMinutes / 60;

        // Check if driver has enough hours
        if (state.hoursWorked + tripHours > maxHoursToday) {
          // Try with base 9h if we were planning 10h
          if (maxHoursToday === 10 && state.hoursWorked + tripHours <= MAX_DAILY_HOURS) {
            // Can't do extended day, but can do normal
          } else {
            continue; // Can't do this trip
          }
        }

        // Calculate times
        const departureTime = new Date(state.nextAvailable);
        const returnTime = new Date(departureTime);
        returnTime.setMinutes(returnTime.getMinutes() + tripDurationMinutes);

        if (returnTime > endOfWorkDay) continue;

        // Find available vehicle
        const vehicle = findAvailableVehicle(vehicles, departureTime, returnTime, tracker);
        if (!vehicle) continue;

        // Execute trip based on type
        let tripTrailers: GeneratedTrip['trailers'] = [];
        let success = false;

        if (tripType === 'SUPPLY_MILANO') {
          // Prendi vuote da Tirano E da Livigno
          const emptyIdsFromTirano = Array.from(tracker.cisternState.atTiranoEmpty);
          const emptyIdsFromLivigno = Array.from(tracker.cisternState.atLivignoEmpty);
          const allEmptyIds = [...emptyIdsFromTirano, ...emptyIdsFromLivigno];
          const availableEmpty: string[] = [];
          const fromLivigno: Set<string> = new Set(emptyIdsFromLivigno);

          for (const id of allEmptyIds) {
            if (isResourceAvailable(id, departureTime, returnTime, tracker.trailerTimeSlots)) {
              availableEmpty.push(id);
              if (availableEmpty.length >= 2) break;
            }
          }

          if (availableEmpty.length >= 2) {
            availableEmpty.forEach(id => {
              reserveResource(id, departureTime, returnTime, driver.id, tracker.trailerTimeSlots);
              // Mark when these cisterns become full at Tirano
              cisternAvailableAt.set(id, returnTime);
              // Rimuovi dallo stato attuale (Tirano o Livigno)
              tracker.cisternState.atTiranoEmpty.delete(id);
              tracker.cisternState.atLivignoEmpty.delete(id);
            });

            tripTrailers = availableEmpty.map(id => ({
              trailerId: id,
              litersLoaded: LITERS_PER_TRAILER,
              isPickup: fromLivigno.has(id), // Se viene da Livigno, è un pickup
              dropOffLocationId: tiranoLocation.id,
            }));

            tripsByType.SUPPLY_MILANO++;
            success = true;
          }
        } else if (tripType === 'SHUTTLE_LIVIGNO') {
          // Find a full cistern (either already at Tirano or just arrived)
          let cisternId: string | null = null;

          // First check cisterns already at Tirano
          const fullIds = Array.from(tracker.cisternState.atTiranoFull);
          cisternId = findAvailableTrailer(fullIds, departureTime, returnTime, tracker);

          // If not found, check cisterns that arrived from SUPPLY
          if (!cisternId) {
            for (const [id, availAt] of cisternAvailableAt) {
              if (availAt <= departureTime &&
                  isResourceAvailable(id, departureTime, returnTime, tracker.trailerTimeSlots)) {
                cisternId = id;
                cisternAvailableAt.delete(id);
                break;
              }
            }
          }

          if (cisternId) {
            reserveResource(cisternId, departureTime, returnTime, driver.id, tracker.trailerTimeSlots);

            tripTrailers = [{
              trailerId: cisternId,
              litersLoaded: LITERS_PER_TRAILER,
              isPickup: true,
            }];

            tracker.cisternState.atTiranoFull.delete(cisternId);
            tracker.cisternState.atTiranoEmpty.add(cisternId);

            remainingLiters -= TRIP_LITERS.SHUTTLE_LIVIGNO;
            tripsByType.SHUTTLE_LIVIGNO++;
            success = true;
          }
        } else if (tripType === 'FULL_ROUND') {
          const emptyIds = [
            ...Array.from(tracker.cisternState.atTiranoEmpty),
            ...Array.from(tracker.cisternState.atLivignoEmpty),
            ...Array.from(tracker.cisternState.atMilano),
          ];
          const cisternId = findAvailableTrailer(emptyIds, departureTime, returnTime, tracker);

          if (cisternId) {
            reserveResource(cisternId, departureTime, returnTime, driver.id, tracker.trailerTimeSlots);

            const fromLivigno = tracker.cisternState.atLivignoEmpty.has(cisternId);
            tripTrailers = [{
              trailerId: cisternId,
              litersLoaded: LITERS_PER_TRAILER,
              isPickup: tracker.cisternState.atTiranoEmpty.has(cisternId) || fromLivigno,
            }];

            tracker.cisternState.atTiranoEmpty.delete(cisternId);
            tracker.cisternState.atLivignoEmpty.delete(cisternId);
            tracker.cisternState.atMilano.delete(cisternId);
            tracker.cisternState.atTiranoEmpty.add(cisternId);

            remainingLiters -= TRIP_LITERS.FULL_ROUND;
            tripsByType.FULL_ROUND++;
            success = true;
          }
        }

        if (!success) continue;

        // Reserve vehicle
        reserveResource(vehicle.id, departureTime, returnTime, driver.id, tracker.vehicleTimeSlots);

        // Create trip
        generatedTrips.push({
          date: currentDay,
          departureTime,
          returnTime,
          vehicleId: vehicle.id,
          driverId: driver.id,
          tripType,
          trailers: tripTrailers,
        });

        // Update driver state
        state.hoursWorked += tripHours;
        state.nextAvailable = returnTime;

        // Track if using extended hours (>9h)
        if (state.hoursWorked > MAX_DAILY_HOURS) {
          state.extendedDaysThisWeek++;
          const weekKey = `${driver.id}-${weekNum}`;
          tracker.driverHoursByWeek.set(`${weekKey}-extended`, state.extendedDaysThisWeek);
        }

        // Update global tracker
        tracker.driverHoursByDate.set(`${driver.id}-${dateKey}`, state.hoursWorked);
        const weekKey = `${driver.id}-${weekNum}`;
        tracker.driverHoursByWeek.set(
          weekKey,
          (tracker.driverHoursByWeek.get(weekKey) || 0) + tripHours
        );

        madeProgress = true;
      }

      // Process any cisterns that have arrived (move from pending to full)
      for (const [cisternId, availAt] of cisternAvailableAt) {
        const now = sortedDrivers.length > 0
          ? sortedDrivers[0].state.nextAvailable
          : new Date(currentDay.setHours(22, 0, 0, 0));
        if (availAt <= now) {
          tracker.cisternState.atTiranoFull.add(cisternId);
          cisternAvailableAt.delete(cisternId);
        }
      }
    }

    // End of day: move all pending cisterns to full
    for (const [cisternId] of cisternAvailableAt) {
      tracker.cisternState.atTiranoFull.add(cisternId);
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

function slotsOverlap(slot1Start: Date, slot1End: Date, slot2Start: Date, slot2End: Date): boolean {
  return slot1Start < slot2End && slot2Start < slot1End;
}

function isResourceAvailable(
  resourceId: string,
  start: Date,
  end: Date,
  timeSlots: Map<string, TimeSlot[]>
): boolean {
  const slots = timeSlots.get(resourceId) || [];
  return !slots.some(slot => slotsOverlap(start, end, slot.start, slot.end));
}

function reserveResource(
  resourceId: string,
  start: Date,
  end: Date,
  driverId: string,
  timeSlots: Map<string, TimeSlot[]>
): void {
  if (!timeSlots.has(resourceId)) {
    timeSlots.set(resourceId, []);
  }
  timeSlots.get(resourceId)!.push({ start, end, driverId });
}

function findAvailableVehicle(
  vehicles: Vehicle[],
  departureTime: Date,
  returnTime: Date,
  tracker: AvailabilityTracker
): Vehicle | null {
  for (const vehicle of vehicles) {
    if (isResourceAvailable(vehicle.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
      return vehicle;
    }
  }
  return null;
}

function findAvailableTrailer(
  trailerIds: string[],
  departureTime: Date,
  returnTime: Date,
  tracker: AvailabilityTracker
): string | null {
  for (const trailerId of trailerIds) {
    if (isResourceAvailable(trailerId, departureTime, returnTime, tracker.trailerTimeSlots)) {
      return trailerId;
    }
  }
  return null;
}

function getWorkingDays(startDate: Date, endDate: Date, includeWeekend: boolean = false): Date[] {
  const days: Date[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    // Se includeWeekend: tutti i giorni. Altrimenti solo Lun-Ven
    if (includeWeekend || (dayOfWeek >= 1 && dayOfWeek <= 5)) {
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

export interface DriverAvailabilityInput {
  driverId: string;
  availableDates: string[]; // Array di date YYYY-MM-DD
}

export interface CalculateMaxInput {
  startDate: string | Date;
  endDate: string | Date;
  initialStates?: {
    trailerId: string;
    locationId: string;
    isFull: boolean;
  }[];
  driverAvailability?: DriverAvailabilityInput[];
  includeWeekend?: boolean;
}

export async function calculateMaxCapacity(
  prisma: PrismaClient,
  input: CalculateMaxInput
): Promise<MaxCapacityResult> {
  // Crea uno schedule temporaneo per usare l'optimizer
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);

  // Valida initialStates se presenti
  let validInitialStates: typeof input.initialStates = undefined;
  if (input.initialStates && input.initialStates.length > 0) {
    const trailerIds = await prisma.trailer.findMany({ select: { id: true } });
    const locationIds = await prisma.location.findMany({ select: { id: true } });
    const validTrailerIds = new Set(trailerIds.map(t => t.id));
    const validLocationIds = new Set(locationIds.map(l => l.id));

    validInitialStates = input.initialStates.filter(s =>
      validTrailerIds.has(s.trailerId) && validLocationIds.has(s.locationId)
    );
    if (validInitialStates.length === 0) validInitialStates = undefined;
  }

  // Valida driverAvailability se presente
  let validDriverAvailability: typeof input.driverAvailability = undefined;
  if (input.driverAvailability && input.driverAvailability.length > 0) {
    const driverIds = await prisma.driver.findMany({ select: { id: true }, where: { isActive: true } });
    const validDriverIds = new Set(driverIds.map(d => d.id));

    validDriverAvailability = input.driverAvailability.filter(a =>
      validDriverIds.has(a.driverId) && a.availableDates.length > 0
    );
    if (validDriverAvailability.length === 0) validDriverAvailability = undefined;
  }

  // Crea schedule fittizio
  const tempSchedule = await prisma.schedule.create({
    data: {
      name: '_MAX_CALC_TEMP_',
      startDate,
      endDate,
      requiredLiters: 999999999, // Massimo possibile
      status: 'DRAFT',
      includeWeekend: input.includeWeekend ?? false,
      initialStates: validInitialStates ? {
        create: validInitialStates.map(s => ({
          trailerId: s.trailerId,
          locationId: s.locationId,
          isFull: s.isFull,
        })),
      } : undefined,
    },
    include: { initialStates: true },
  });

  try {
    // Usa l'optimizer reale con disponibilità driver
    const result = await optimizeSchedule(prisma, tempSchedule.id, validDriverAvailability);

    // Conta solo i litri effettivamente consegnati (SHUTTLE)
    const shuttleTrips = result.trips.filter(t => t.tripType === 'SHUTTLE_LIVIGNO');
    const supplyTrips = result.trips.filter(t => t.tripType === 'SUPPLY_MILANO');
    const fullRoundTrips = result.trips.filter(t => t.tripType === 'FULL_ROUND');

    const maxLiters = shuttleTrips.length * LITERS_PER_TRAILER +
                      fullRoundTrips.length * LITERS_PER_TRAILER;

    const workingDays = getWorkingDays(startDate, endDate, input.includeWeekend);
    const numWorkingDays = workingDays.length;

    const constraints: string[] = [];
    if (result.warnings.length > 0) {
      constraints.push(...result.warnings);
    }

    // Conta shuttle per driver Livigno vs Tirano
    const locations = await prisma.location.findMany({ where: { isActive: true } });
    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      include: { baseLocation: true },
    });
    const livignoLocation = locations.find(l => l.type === 'DESTINATION');

    let livignoShuttles = 0;
    let tiranoShuttles = 0;
    for (const trip of shuttleTrips) {
      const driver = drivers.find(d => d.id === trip.driverId);
      if (driver?.baseLocationId === livignoLocation?.id) {
        livignoShuttles++;
      } else {
        tiranoShuttles++;
      }
    }

    return {
      maxLiters,
      workingDays: numWorkingDays,
      breakdown: {
        livignoDriverShuttles: livignoShuttles,
        tiranoDriverShuttles: tiranoShuttles,
        tiranoDriverFullRounds: fullRoundTrips.length,
        supplyTrips: supplyTrips.length,
      },
      dailyCapacity: numWorkingDays > 0 ? Math.floor(maxLiters / numWorkingDays) : 0,
      constraints,
    };
  } finally {
    // Elimina schedule temporaneo e tutti i trip generati
    await prisma.tripTrailer.deleteMany({
      where: { trip: { scheduleId: tempSchedule.id } },
    });
    await prisma.trip.deleteMany({ where: { scheduleId: tempSchedule.id } });
    await prisma.scheduleInitialState.deleteMany({ where: { scheduleId: tempSchedule.id } });
    await prisma.schedule.delete({ where: { id: tempSchedule.id } });
  }
}
