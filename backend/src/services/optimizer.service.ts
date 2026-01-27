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
      TRANSFER_TIRANO: number;
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

// ============================================================================
// NUOVO MODELLO LOGISTICO - MOTRICI CON CISTERNA INTEGRATA
// ============================================================================
// Le motrici hanno una cisterna integrata (17.500L, non staccabile) e possono
// trainare max 1 rimorchio. I rimorchi pieni NON salgono MAI a Livigno.
// Il trasferimento del carburante avviene tramite sversamento a Tirano.
// ============================================================================

// Durate viaggi in minuti
const TRIP_DURATIONS = {
  SHUTTLE_LIVIGNO: 270,              // 120 (andata) + 120 (ritorno) + 30 (scarico) = 4.5h
  SUPPLY_MILANO_FROM_TIRANO: 360,    // 150 (andata) + 150 (ritorno) + 60 (carico) = 6h
  SUPPLY_MILANO_FROM_LIVIGNO: 600,   // 6h + 4h (Livigno↔Tirano extra, 120min*2) = 10h
  FULL_ROUND: 540,                   // 9h (aggiornato con tempi montagna 2h)
  TRANSFER_TIRANO: 30,               // Sversamento rimorchio pieno → motrice vuota
};

// Litri consegnati a Livigno per tipo viaggio
const TRIP_LITERS = {
  SHUTTLE_LIVIGNO: 17500,  // Cisterna integrata della motrice
  SUPPLY_MILANO: 35000,    // Motrice (17.500) + 1 rimorchio (17.500) - non consegna, riempie Tirano
  FULL_ROUND: 17500,       // Cisterna integrata a Livigno
  TRANSFER_TIRANO: 17500,  // Sversamento rimorchio → cisterna integrata
};

// Rimorchi utilizzati per tipo viaggio
const TRIP_TRAILERS = {
  SHUTTLE_LIVIGNO: 0,  // Solo motrice sale (cisterna integrata)
  SUPPLY_MILANO: 1,    // Motrice + 1 rimorchio vuoto → tornano pieni
  FULL_ROUND: 0,       // Solo motrice
  TRANSFER_TIRANO: 1,  // 1 rimorchio pieno viene sversato
};

const LITERS_PER_TRAILER = 17500;
const LITERS_PER_INTEGRATED_TANK = 17500;
const DEFAULT_DEPARTURE_HOUR = 6;
const MAX_DAILY_HOURS = 9; // ADR limit
const MAX_SHUTTLE_PER_DAY_LIVIGNO_DRIVER = 3;

// ============================================================================
// STATO CISTERNE
// ============================================================================

// Stato RIMORCHI (staccabili, base Tirano)
interface TrailerState {
  atTiranoFull: Set<string>;   // ID rimorchi pieni a Tirano (da sversare)
  atTiranoEmpty: Set<string>;  // ID rimorchi vuoti a Tirano (per SUPPLY)
  atMilano: Set<string>;       // ID rimorchi a Milano (sorgente)
  inTransit: Set<string>;      // ID rimorchi in viaggio
}

// Stato MOTRICI (cisterna integrata)
interface VehicleTankState {
  tankFull: Map<string, boolean>;      // vehicleId → cisterna integrata piena/vuota
  location: Map<string, string>;       // vehicleId → locationId corrente
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
  trailerState: TrailerState;                // Stato rimorchi
  vehicleTankState: VehicleTankState;        // Stato cisterne integrate motrici
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
    trailerState: {
      atTiranoFull: new Set(),
      atTiranoEmpty: new Set(),
      atMilano: new Set(),
      inTransit: new Set(),
    },
    vehicleTankState: {
      tankFull: new Map(),
      location: new Map(),
    },
  };

  // Initialize TRAILER state from schedule initial states or default based on baseLocation
  // NOTA: I rimorchi sono sempre a Tirano o Milano, MAI a Livigno
  for (const trailer of trailers) {
    const initialState = schedule.initialStates.find(s => s.trailerId === trailer.id);

    if (initialState) {
      if (initialState.location.type === 'SOURCE') {
        // A Milano
        tracker.trailerState.atMilano.add(trailer.id);
      } else {
        // A Tirano (PARKING) - i rimorchi non vanno mai a Livigno
        if (initialState.isFull) {
          tracker.trailerState.atTiranoFull.add(trailer.id);
        } else {
          tracker.trailerState.atTiranoEmpty.add(trailer.id);
        }
      }
    } else {
      // Default: tutti i rimorchi partono vuoti a Tirano
      tracker.trailerState.atTiranoEmpty.add(trailer.id);
    }
  }

  // Initialize VEHICLE TANK state (cisterna integrata)
  // Fetch vehicle states from schedule if available
  const vehicleStates = await prisma.scheduleVehicleState.findMany({
    where: { scheduleId },
    include: { location: true },
  });

  for (const vehicle of vehicles) {
    const vehicleState = vehicleStates.find(s => s.vehicleId === vehicle.id);

    if (vehicleState) {
      tracker.vehicleTankState.tankFull.set(vehicle.id, vehicleState.isTankFull);
      tracker.vehicleTankState.location.set(vehicle.id, vehicleState.locationId);
    } else {
      // Default: cisterna integrata vuota, posizione = base della motrice
      tracker.vehicleTankState.tankFull.set(vehicle.id, false);
      tracker.vehicleTankState.location.set(vehicle.id, vehicle.baseLocationId || tiranoLocation.id);
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
  const tripsByType = { SHUTTLE_LIVIGNO: 0, SUPPLY_MILANO: 0, FULL_ROUND: 0, TRANSFER_TIRANO: 0 };

  // ============================================================================
  // NUOVO ALGORITMO DI OTTIMIZZAZIONE - MOTRICI CON CISTERNA INTEGRATA
  // ============================================================================
  // PRIORITÀ ASSEGNAZIONE:
  // 1. Se motrice piena a Tirano → SHUTTLE_LIVIGNO (sale solo la motrice)
  // 2. Se motrice vuota + rimorchio pieno a Tirano → TRANSFER_TIRANO (30 min sversamento)
  // 3. Se rimorchi vuoti a Tirano + motrice disponibile → SUPPLY_MILANO (motrice + 1 rimorchio)
  // 4. Fallback → FULL_ROUND o attesa
  //
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

    // Track when trailers become available (after SUPPLY returns)
    // Key: trailerId, Value: time when it becomes full at Tirano
    const trailerAvailableAt = new Map<string, Date>();

    // Track when vehicle tanks become full (after TRANSFER)
    // Key: vehicleId, Value: time when integrated tank becomes full at Tirano
    const vehicleTankAvailableAt = new Map<string, Date>();

    // End of work day
    const endOfWorkDay = new Date(currentDay);
    endOfWorkDay.setHours(22, 0, 0, 0);

    // =========================================================================
    // ALGORITMO CON CISTERNE INTEGRATE:
    // 1. TRANSFER: sversamento rimorchio pieno → motrice vuota (30 min)
    // 2. SHUTTLE: motrice piena → Livigno → ritorna vuota (4.5h)
    // 3. SUPPLY: motrice + 1 rimorchio → Milano → tornano pieni (6h)
    // 4. FULL_ROUND: fallback se nessuna risorsa disponibile
    //
    // L'obiettivo è massimizzare i litri consegnati a Livigno.
    // I rimorchi pieni NON salgono MAI a Livigno!
    // =========================================================================

    // Filtra driver disponibili oggi
    // Logica:
    // - Se driverAvailability ha entries → usa SOLO quelle date esplicite
    //   (se un driver non è nella lista, NON è disponibile)
    // - Se driverAvailability è vuoto/undefined → usa default per tipo
    //   (RESIDENT = tutti i giorni, ON_CALL/EMERGENCY = mai)
    //
    // IMPORTANTE: Il frontend include solo driver con almeno 1 giorno selezionato.
    // Se un RESIDENT ha 0 giorni selezionati, non sarà nella lista e non lavorerà.
    const availableDriversToday = [...drivers]
      .filter(d => {
        if (driverAvailability && driverAvailability.length > 0) {
          // L'utente ha fatto selezioni esplicite → usa SOLO quelle
          const availability = driverAvailability.find(a => a.driverId === d.id);
          if (availability) {
            // Driver nella lista: usa le date specificate
            return availability.availableDates.includes(dateKey);
          } else {
            // Driver NON nella lista: NON disponibile (indipendentemente dal tipo)
            return false;
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
      const emptyTrailersAtTirano = tracker.trailerState.atTiranoEmpty.size;
      const fullTrailersAtTirano = tracker.trailerState.atTiranoFull.size;

      // Trova il prossimo driver libero
      // IMPORTANTE: ordina per dare priorità ai RESIDENT, poi per tempo disponibile
      // Questo evita che driver ON_CALL/EMERGENCY "rubino" trip ai RESIDENT
      const sortedDrivers = availableDriversToday
        .map(d => ({ driver: d, state: driverState.get(d.id)! }))
        .filter(({ state }) => state && state.nextAvailable < endOfWorkDay)
        .sort((a, b) => {
          // Prima ordina per tipo: RESIDENT > ON_CALL > EMERGENCY
          const typePriority: Record<string, number> = { RESIDENT: 0, ON_CALL: 1, EMERGENCY: 2 };
          const typeDiff = typePriority[a.driver.type] - typePriority[b.driver.type];
          if (typeDiff !== 0) return typeDiff;

          // Poi per tempo disponibile
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

        const availableTime = state.nextAvailable;
        const isLivignoDriver = driver.baseLocationId === livignoLocation.id;

        // Conta rimorchi pieni disponibili (inclusi quelli in arrivo)
        let fullTrailersAvailable = tracker.trailerState.atTiranoFull.size;
        let pendingFullTrailers: { id: string; availableAt: Date }[] = [];

        for (const [trailerId, availAt] of trailerAvailableAt) {
          if (availAt <= availableTime) {
            fullTrailersAvailable++;
          } else {
            pendingFullTrailers.push({ id: trailerId, availableAt: availAt });
          }
        }

        // Conta motrici con cisterna integrata piena a Tirano
        let vehiclesWithFullTankAtTirano = 0;
        let vehiclesWithEmptyTankAtTirano = 0;
        let pendingFullTanks: { id: string; availableAt: Date }[] = [];

        for (const vehicle of vehicles) {
          const location = tracker.vehicleTankState.location.get(vehicle.id);
          const isFull = tracker.vehicleTankState.tankFull.get(vehicle.id);
          if (location === tiranoLocation.id) {
            if (isFull) vehiclesWithFullTankAtTirano++;
            else vehiclesWithEmptyTankAtTirano++;
          }
        }

        // Controlla cisterne integrate in arrivo (dopo TRANSFER)
        for (const [vehicleId, availAt] of vehicleTankAvailableAt) {
          if (availAt <= availableTime) {
            vehiclesWithFullTankAtTirano++;
          } else {
            pendingFullTanks.push({ id: vehicleId, availableAt: availAt });
          }
        }

        let tripType: TripType | null = null;
        let tripDurationMinutes: number = 0;
        let waitUntil: Date | null = null;

        // Max ore oggi (9h o 10h con estensione)
        // Usa sempre estensione se disponibile (max 2 per settimana)
        let maxHoursToday = MAX_DAILY_HOURS;
        if (state.extendedDaysThisWeek < 2) {
          maxHoursToday = 10;
        }

        const supplyDuration = isLivignoDriver
          ? TRIP_DURATIONS.SUPPLY_MILANO_FROM_LIVIGNO
          : TRIP_DURATIONS.SUPPLY_MILANO_FROM_TIRANO;
        const supplyHours = supplyDuration / 60;
        const shuttleHours = TRIP_DURATIONS.SHUTTLE_LIVIGNO / 60; // 4.5h
        const transferHours = TRIP_DURATIONS.TRANSFER_TIRANO / 60; // 0.5h

        const hoursUntilEndOfDay = (endOfWorkDay.getTime() - availableTime.getTime()) / (1000 * 60 * 60);
        const hoursRemaining = maxHoursToday - state.hoursWorked;
        const canDoSupply = hoursRemaining >= supplyHours && hoursUntilEndOfDay >= supplyHours;
        const canDoShuttle = hoursRemaining >= shuttleHours && hoursUntilEndOfDay >= shuttleHours;
        const canDoTransfer = hoursRemaining >= transferHours && hoursUntilEndOfDay >= transferHours;
        const canDoFullRound = hoursRemaining >= 9 && hoursUntilEndOfDay >= 9;

        // Calcola quanti rimorchi pieni sono in attesa o in arrivo
        const pendingFullTrailerCount = fullTrailersAvailable + pendingFullTrailers.length;

        // Calcola quante motrici vuote saranno disponibili per TRANSFER
        const vehiclesAvailableForTransfer = vehiclesWithEmptyTankAtTirano +
          pendingFullTanks.filter(p => p.availableAt <= endOfWorkDay).length;

        // Calcola il "bilancio risorse": quante motrici piene abbiamo/avremo
        // vs quanti SHUTTLE possiamo fare oggi
        const totalMotriciPiene = vehiclesWithFullTankAtTirano + pendingFullTanks.length;
        const totalRimorchiPieni = fullTrailersAvailable + pendingFullTrailers.length;

        // Stima degli SHUTTLE possibili oggi (basata su driver disponibili e tempo)
        const potentialShuttlesToday = Math.floor(
          availableDriversToday.reduce((sum, d) => {
            const dState = driverState.get(d.id);
            if (!dState) return sum;
            const dHoursLeft = maxHoursToday - dState.hoursWorked;
            return sum + Math.floor(dHoursLeft / shuttleHours);
          }, 0)
        );

        // Calcola quanti giorni rimangono (incluso oggi)
        const currentDayIndex = workingDays.findIndex(d =>
          d.toISOString().split('T')[0] === dateKey
        );
        const remainingDays = workingDays.length - currentDayIndex;

        // Se siamo nell'ultimo giorno, priorità assoluta a SHUTTLE (smaltisci tutto)
        // Altrimenti, bilancia: assicurati di avere risorse per i giorni successivi
        const isLastDay = remainingDays <= 1;

        // Calcola se abbiamo abbastanza risorse per i prossimi giorni
        // Regola: vogliamo almeno 1 rimorchio pieno per ogni giorno rimanente
        const minResourcesNeeded = isLastDay ? 0 : Math.min(remainingDays - 1, trailers.length / 2);
        const currentResources = totalRimorchiPieni + pendingFullTrailerCount;
        const needMoreSupply = currentResources < minResourcesNeeded && emptyTrailersAtTirano > 0;

        // ALGORITMO GREEDY SEMPLICE:
        // Priorità: SHUTTLE > TRANSFER > SUPPLY > FULL_ROUND
        // Tutti i driver seguono la stessa logica

        if (vehiclesWithFullTankAtTirano >= 1 && canDoShuttle) {
          tripType = 'SHUTTLE_LIVIGNO';
          tripDurationMinutes = TRIP_DURATIONS.SHUTTLE_LIVIGNO;
        }
        else if (vehiclesWithEmptyTankAtTirano >= 1 && fullTrailersAvailable >= 1 && canDoTransfer) {
          tripType = 'TRANSFER_TIRANO';
          tripDurationMinutes = TRIP_DURATIONS.TRANSFER_TIRANO;
        }
        else if (emptyTrailersAtTirano >= 1 && canDoSupply) {
          tripType = 'SUPPLY_MILANO';
          tripDurationMinutes = supplyDuration;
        }
        else if (pendingFullTanks.length > 0 || pendingFullTrailers.length > 0) {
          // Aspetta risorse in arrivo
          const nextAvailable = [
            ...pendingFullTanks.map(p => p.availableAt),
            ...pendingFullTrailers.map(p => p.availableAt),
          ].sort((a, b) => a.getTime() - b.getTime())[0];
          if (nextAvailable) {
            waitUntil = nextAvailable;
          }
        }
        else if (canDoFullRound && (emptyTrailersAtTirano > 0 || tracker.trailerState.atMilano.size > 0)) {
          tripType = 'FULL_ROUND';
          tripDurationMinutes = TRIP_DURATIONS.FULL_ROUND;
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

        // Find available vehicle based on trip type requirements
        let vehicle: typeof vehicles[0] | null = null;
        let tripTrailers: GeneratedTrip['trailers'] = [];
        let success = false;

        if (tripType === 'SHUTTLE_LIVIGNO') {
          // Trova motrice con cisterna integrata PIENA a Tirano
          for (const v of vehicles) {
            const location = tracker.vehicleTankState.location.get(v.id);
            const isFull = tracker.vehicleTankState.tankFull.get(v.id);
            if (location === tiranoLocation.id && isFull &&
                isResourceAvailable(v.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
              vehicle = v;
              break;
            }
          }

          // Controlla anche motrici in arrivo (dopo TRANSFER)
          if (!vehicle) {
            for (const [vehicleId, availAt] of vehicleTankAvailableAt) {
              if (availAt <= departureTime &&
                  isResourceAvailable(vehicleId, departureTime, returnTime, tracker.vehicleTimeSlots)) {
                vehicle = vehicles.find(v => v.id === vehicleId) || null;
                if (vehicle) {
                  vehicleTankAvailableAt.delete(vehicleId);
                  break;
                }
              }
            }
          }

          if (vehicle) {
            reserveResource(vehicle.id, departureTime, returnTime, driver.id, tracker.vehicleTimeSlots);

            // La motrice sale a Livigno con cisterna integrata piena, torna vuota
            tripTrailers = []; // Nessun rimorchio per SHUTTLE!

            // Aggiorna stato: cisterna integrata da piena a vuota, posizione rimane Tirano
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);

            remainingLiters -= TRIP_LITERS.SHUTTLE_LIVIGNO;
            tripsByType.SHUTTLE_LIVIGNO++;
            success = true;
          }
        } else if (tripType === 'TRANSFER_TIRANO') {
          // Trova motrice con cisterna integrata VUOTA a Tirano
          for (const v of vehicles) {
            const location = tracker.vehicleTankState.location.get(v.id);
            const isFull = tracker.vehicleTankState.tankFull.get(v.id);
            if (location === tiranoLocation.id && !isFull &&
                isResourceAvailable(v.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
              vehicle = v;
              break;
            }
          }

          // Trova rimorchio pieno a Tirano
          let trailerId: string | null = null;
          if (vehicle) {
            const fullIds = Array.from(tracker.trailerState.atTiranoFull);
            trailerId = findAvailableTrailer(fullIds, departureTime, returnTime, tracker);

            // Controlla anche rimorchi in arrivo
            if (!trailerId) {
              for (const [id, availAt] of trailerAvailableAt) {
                if (availAt <= departureTime &&
                    isResourceAvailable(id, departureTime, returnTime, tracker.trailerTimeSlots)) {
                  trailerId = id;
                  trailerAvailableAt.delete(id);
                  break;
                }
              }
            }
          }

          if (vehicle && trailerId) {
            reserveResource(vehicle.id, departureTime, returnTime, driver.id, tracker.vehicleTimeSlots);
            reserveResource(trailerId, departureTime, returnTime, driver.id, tracker.trailerTimeSlots);

            tripTrailers = [{
              trailerId: trailerId,
              litersLoaded: LITERS_PER_TRAILER,
              isPickup: true, // Il rimorchio viene "prelevato" per sversamento
              dropOffLocationId: tiranoLocation.id, // Rimane a Tirano (vuoto dopo sversamento)
            }];

            // Aggiorna stato: rimorchio da pieno a vuoto, cisterna integrata da vuota a piena
            tracker.trailerState.atTiranoFull.delete(trailerId);
            tracker.trailerState.atTiranoEmpty.add(trailerId);
            tracker.vehicleTankState.tankFull.set(vehicle.id, true);

            // TRANSFER non consegna a Livigno, solo prepara la motrice
            tripsByType.TRANSFER_TIRANO++;
            success = true;
          }
        } else if (tripType === 'SUPPLY_MILANO') {
          // Trova motrice disponibile - preferibilmente dalla stessa base del driver
          // Driver di Livigno possono usare motrici a Livigno (SUPPLY più lungo: 10h)
          // Driver di Tirano usano motrici a Tirano (SUPPLY normale: 6h)
          const driverLocationId = driver.baseLocationId || tiranoLocation.id;

          // Prima cerca motrice nella stessa location del driver
          for (const v of vehicles) {
            const location = tracker.vehicleTankState.location.get(v.id);
            if (location === driverLocationId &&
                isResourceAvailable(v.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
              vehicle = v;
              break;
            }
          }

          // Se non trovata, cerca a Tirano (fallback per driver senza base definita)
          if (!vehicle) {
            for (const v of vehicles) {
              const location = tracker.vehicleTankState.location.get(v.id);
              if (location === tiranoLocation.id &&
                  isResourceAvailable(v.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
                vehicle = v;
                break;
              }
            }
          }

          // Trova 1 rimorchio vuoto a Tirano
          let trailerId: string | null = null;
          if (vehicle) {
            const emptyIds = Array.from(tracker.trailerState.atTiranoEmpty);
            trailerId = findAvailableTrailer(emptyIds, departureTime, returnTime, tracker);
          }

          if (vehicle && trailerId) {
            reserveResource(vehicle.id, departureTime, returnTime, driver.id, tracker.vehicleTimeSlots);
            reserveResource(trailerId, departureTime, returnTime, driver.id, tracker.trailerTimeSlots);

            tripTrailers = [{
              trailerId: trailerId,
              litersLoaded: LITERS_PER_TRAILER,
              isPickup: true, // Prende rimorchio vuoto
              dropOffLocationId: tiranoLocation.id, // Torna pieno a Tirano
            }];

            // Il rimorchio sarà pieno al ritorno (a Tirano)
            tracker.trailerState.atTiranoEmpty.delete(trailerId);
            trailerAvailableAt.set(trailerId, returnTime);

            // La cisterna integrata sarà piena al ritorno
            const wasIntegratedTankFull = tracker.vehicleTankState.tankFull.get(vehicle.id);
            if (!wasIntegratedTankFull) {
              vehicleTankAvailableAt.set(vehicle.id, returnTime);
            }

            // IMPORTANTE: la motrice torna SEMPRE a Tirano dopo SUPPLY
            // (anche se partiva da Livigno)
            tracker.vehicleTankState.location.set(vehicle.id, tiranoLocation.id);

            tripsByType.SUPPLY_MILANO++;
            success = true;
          }
        } else if (tripType === 'FULL_ROUND') {
          // FULL_ROUND: motrice va a Milano, carica cisterna integrata, consegna a Livigno
          for (const v of vehicles) {
            const location = tracker.vehicleTankState.location.get(v.id);
            if (location === tiranoLocation.id &&
                isResourceAvailable(v.id, departureTime, returnTime, tracker.vehicleTimeSlots)) {
              vehicle = v;
              break;
            }
          }

          if (vehicle) {
            reserveResource(vehicle.id, departureTime, returnTime, driver.id, tracker.vehicleTimeSlots);

            tripTrailers = []; // Nessun rimorchio per FULL_ROUND

            // La cisterna integrata viene usata per il giro completo
            // Torna vuota a Tirano
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);

            remainingLiters -= TRIP_LITERS.FULL_ROUND;
            tripsByType.FULL_ROUND++;
            success = true;
          }
        }

        if (!success) continue;

        // Create trip
        generatedTrips.push({
          date: currentDay,
          departureTime,
          returnTime,
          vehicleId: vehicle!.id,
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

      // Process any trailers that have arrived (move from pending to full)
      for (const [trailerId, availAt] of trailerAvailableAt) {
        const now = sortedDrivers.length > 0
          ? sortedDrivers[0].state.nextAvailable
          : new Date(currentDay.setHours(22, 0, 0, 0));
        if (availAt <= now) {
          tracker.trailerState.atTiranoFull.add(trailerId);
          trailerAvailableAt.delete(trailerId);
        }
      }

      // Process any vehicle tanks that have become full
      for (const [vehicleId, availAt] of vehicleTankAvailableAt) {
        const now = sortedDrivers.length > 0
          ? sortedDrivers[0].state.nextAvailable
          : new Date(currentDay.setHours(22, 0, 0, 0));
        if (availAt <= now) {
          tracker.vehicleTankState.tankFull.set(vehicleId, true);
          vehicleTankAvailableAt.delete(vehicleId);
        }
      }
    }

    // End of day: move all pending trailers to full
    for (const [trailerId] of trailerAvailableAt) {
      tracker.trailerState.atTiranoFull.add(trailerId);
    }

    // End of day: mark all pending vehicle tanks as full
    for (const [vehicleId] of vehicleTankAvailableAt) {
      tracker.vehicleTankState.tankFull.set(vehicleId, true);
    }
  }

  // Add warnings
  if (remainingLiters > 0) {
    warnings.push(`Litri non coperti: ${remainingLiters.toLocaleString()}L - Servono più giorni o risorse`);
  }

  if (tripsByType.SUPPLY_MILANO === 0 && tripsByType.SHUTTLE_LIVIGNO > 2) {
    warnings.push('Attenzione: nessun viaggio SUPPLY. I rimorchi a Tirano potrebbero esaurirsi.');
  }

  if (tripsByType.TRANSFER_TIRANO === 0 && tripsByType.SUPPLY_MILANO > 0) {
    warnings.push('Attenzione: nessun TRANSFER. I rimorchi pieni a Tirano non vengono sversati nelle motrici.');
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

  const trailersAtParking = tracker.trailerState.atTiranoFull.size + tracker.trailerState.atTiranoEmpty.size;

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
  daysWithDeliveries: number; // Giorni con almeno un autista disponibile e consegne effettive
  breakdown: {
    livignoDriverShuttles: number;
    livignoSupplyTrips: number;  // SUPPLY da Livigno (10h, eccezione ADR max 2/settimana)
    tiranoDriverShuttles: number;
    tiranoDriverFullRounds: number;
    supplyTrips: number;        // SUPPLY da Tirano (6h)
    transferTrips: number;      // Sversamenti a Tirano
  };
  dailyCapacity: number; // maxLiters / daysWithDeliveries
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
  // ============================================================================
  // ALGORITMO DI OTTIMIZZAZIONE GLOBALE V2
  // ============================================================================
  // Traccia le ore per ogni driver individualmente (requisito ADR).
  // I driver possono scambiarsi di posto quando si incontrano (risorse condivise).
  // Garantisce che aggiungere giorni-driver non peggiori MAI il risultato.
  // ============================================================================

  const HOURS_SUPPLY = 6;
  const HOURS_SUPPLY_LIVIGNO = 10; // Livigno→Tirano→Milano→Tirano→Livigno (richiede eccezione ADR)
  const HOURS_TRANSFER = 0.5;
  const HOURS_SHUTTLE = 4.5;
  const HOURS_FULL_ROUND = 9;
  const MAX_ADR_EXTENDED_PER_WEEK = 2; // ADR permette 10h max 2 volte/settimana

  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const workingDays = getWorkingDays(startDate, endDate, input.includeWeekend ?? false);
  const allDates = workingDays.map(d => d.toISOString().split('T')[0]);

  // Carica risorse dal DB
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
    }),
    prisma.location.findMany({ where: { isActive: true } }),
  ]);

  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const tiranoLocation = locations.find(l => l.type === 'PARKING');

  if (!livignoLocation || !tiranoLocation) {
    throw new Error('Missing required locations (Livigno, Tirano)');
  }

  const numTrailers = trailers.length;
  const numVehicles = vehicles.filter(v => v.baseLocationId !== livignoLocation.id).length;

  // Separa driver per base: Tirano e Livigno operano in parallelo
  const tiranoDrivers = drivers.filter(d => d.baseLocationId !== livignoLocation.id);
  const livignoDrivers = drivers.filter(d => d.baseLocationId === livignoLocation.id);

  // Valida e prepara driverAvailability
  let validDriverAvailability = input.driverAvailability;
  if (validDriverAvailability && validDriverAvailability.length > 0) {
    const validDriverIds = new Set(drivers.map(d => d.id));
    validDriverAvailability = validDriverAvailability.filter(a =>
      validDriverIds.has(a.driverId) && a.availableDates.length > 0
    );
    if (validDriverAvailability.length === 0) validDriverAvailability = undefined;
  }

  // Funzione per costruire la lista di driver disponibili per ogni giorno
  // Restituisce sia driver Tirano che Livigno separatamente
  const getDriversPerDay = (avail: DriverAvailabilityInput[] | undefined): {
    tirano: { id: string; maxHours: number }[][];
    livigno: { id: string; maxHours: number }[][];
  } => {
    const tiranoPerDay: { id: string; maxHours: number }[][] = [];
    const livignoPerDay: { id: string; maxHours: number }[][] = [];

    for (const day of workingDays) {
      const dateKey = day.toISOString().split('T')[0];
      const dayTiranoDrivers: { id: string; maxHours: number }[] = [];
      const dayLivignoDrivers: { id: string; maxHours: number }[] = [];

      // Driver Tirano
      for (const driver of tiranoDrivers) {
        let isAvailable = false;

        if (avail && avail.length > 0) {
          const driverAvail = avail.find(a => a.driverId === driver.id);
          if (driverAvail) {
            isAvailable = driverAvail.availableDates.includes(dateKey);
          }
        } else {
          // Default: solo RESIDENT disponibili
          isAvailable = driver.type === 'RESIDENT';
        }

        if (isAvailable) {
          dayTiranoDrivers.push({ id: driver.id, maxHours: MAX_DAILY_HOURS });
        }
      }

      // Driver Livigno
      for (const driver of livignoDrivers) {
        let isAvailable = false;

        if (avail && avail.length > 0) {
          const driverAvail = avail.find(a => a.driverId === driver.id);
          if (driverAvail) {
            isAvailable = driverAvail.availableDates.includes(dateKey);
          }
        } else {
          // Default: solo RESIDENT disponibili
          isAvailable = driver.type === 'RESIDENT';
        }

        if (isAvailable) {
          dayLivignoDrivers.push({ id: driver.id, maxHours: MAX_DAILY_HOURS });
        }
      }

      tiranoPerDay.push(dayTiranoDrivers);
      livignoPerDay.push(dayLivignoDrivers);
    }

    return { tirano: tiranoPerDay, livigno: livignoPerDay };
  };

  // Algoritmo di ottimizzazione globale V2 con tracciamento ore driver individuali
  // Supporta driver Tirano (SUPPLY, TRANSFER, SHUTTLE, FULL_ROUND) e Livigno (SHUTTLE + SUPPLY con eccezione ADR)
  const calculateGlobalMaxV2 = (driversData: {
    tirano: { id: string; maxHours: number }[][];
    livigno: { id: string; maxHours: number }[][];
  }): {
    totalLiters: number;
    breakdown: {
      supplyTrips: number;
      transferTrips: number;
      shuttleTrips: number;
      fullRoundTrips: number;
      livignoShuttles: number;
      livignoSupplyTrips: number;
    };
    daysWithDeliveries: number;
  } => {
    const { tirano: tiranoPerDay, livigno: livignoPerDay } = driversData;
    const numDays = tiranoPerDay.length;
    if (numDays === 0) {
      return {
        totalLiters: 0,
        breakdown: { supplyTrips: 0, transferTrips: 0, shuttleTrips: 0, fullRoundTrips: 0, livignoShuttles: 0, livignoSupplyTrips: 0 },
        daysWithDeliveries: 0,
      };
    }

    // Stato risorse (condivise tra tutti i driver)
    let fullTrailers = 0;
    let emptyTrailers = numTrailers;
    let fullTanks = 0;
    let emptyTanks = numVehicles;

    // Contatori totali
    let totalLiters = 0;
    let totalSupply = 0;
    let totalTransfer = 0;
    let totalShuttle = 0;
    let totalFullRound = 0;
    let totalLivignoShuttle = 0;
    let totalLivignoSupply = 0;
    let daysWithDeliveries = 0;

    // Traccia eccezioni ADR usate per driver Livigno (max 2/settimana)
    // Resettiamo ogni 5 giorni lavorativi (approssimazione settimana)
    const livignoAdrExceptions = new Map<string, number>();

    for (let day = 0; day < numDays; day++) {
      const tiranoDriversToday = tiranoPerDay[day];
      const livignoDriversToday = livignoPerDay[day];
      const remainingDays = numDays - day;
      const isLastDay = remainingDays === 1;

      // Reset eccezioni ADR ogni 5 giorni (nuova settimana lavorativa)
      if (day > 0 && day % 5 === 0) {
        livignoAdrExceptions.clear();
      }

      // Stato ore driver Tirano per oggi
      const tiranoDriverHours = new Map<string, number>();
      for (const d of tiranoDriversToday) {
        tiranoDriverHours.set(d.id, d.maxHours);
      }

      // Stato ore driver Livigno per oggi
      const livignoDriverHours = new Map<string, number>();
      for (const d of livignoDriversToday) {
        livignoDriverHours.set(d.id, d.maxHours);
      }

      let litersToday = 0;

      // Risorse che arriveranno dopo i SUPPLY
      let pendingFullTrailers = 0;
      let pendingFullTanks = 0;
      let suppliesDone = 0;

      // =====================================================================
      // FASE 1: SUPPLY (primi trip della giornata)
      // Driver Tirano: SUPPLY standard (6h)
      // Driver Livigno: SUPPLY con eccezione ADR (10h, max 2/settimana)
      // =====================================================================
      let livignoSuppliesDone = 0;

      if (!isLastDay) {
        // Calcola quanti SUPPLY servono basandosi sui driver di domani (Tirano + Livigno)
        const tomorrowTiranoDrivers = tiranoPerDay[day + 1] || [];
        const tomorrowLivignoDrivers = livignoPerDay[day + 1] || [];
        const tomorrowTiranoHours = tomorrowTiranoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
        const tomorrowLivignoHours = tomorrowLivignoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
        // Driver Tirano: SHUTTLE standard; Driver Livigno: SHUTTLE (consumano fullTanks)
        const tomorrowShuttlePotential = Math.floor(tomorrowTiranoHours / HOURS_SHUTTLE) +
                                         Math.floor(tomorrowLivignoHours / HOURS_SHUTTLE);
        const currentResources = fullTanks + fullTrailers;
        const resourcesNeeded = Math.max(0, tomorrowShuttlePotential - currentResources);
        const suppliesWanted = Math.ceil(resourcesNeeded / 2);

        // Prima: fai SUPPLY con i driver Tirano che hanno tempo (più efficiente, 6h)
        for (const [driverId, hoursLeft] of tiranoDriverHours) {
          if (suppliesDone >= suppliesWanted) break;
          if (hoursLeft < HOURS_SUPPLY) continue;
          if (emptyTrailers <= 0) break;
          if (emptyTanks <= 0) break;

          tiranoDriverHours.set(driverId, hoursLeft - HOURS_SUPPLY);
          emptyTrailers--;
          emptyTanks--;
          pendingFullTrailers++;
          pendingFullTanks++;
          totalSupply++;
          suppliesDone++;
        }

        // Poi: se servono ancora SUPPLY, usa driver Livigno con eccezione ADR (10h)
        // L'eccezione ADR permette di estendere da 9h a 10h, max 2 volte/settimana
        if (suppliesDone < suppliesWanted) {
          for (const [driverId, hoursLeft] of livignoDriverHours) {
            if (suppliesDone >= suppliesWanted) break;
            // Il driver deve avere tutte le sue ore disponibili (giornata piena)
            // perché SUPPLY Livigno (10h) consuma tutta la giornata + 1h eccezione
            if (hoursLeft < MAX_DAILY_HOURS) continue;
            if (emptyTrailers <= 0) break;
            if (emptyTanks <= 0) break;

            // Verifica limite eccezioni ADR (max 2/settimana)
            const usedExceptions = livignoAdrExceptions.get(driverId) || 0;
            if (usedExceptions >= MAX_ADR_EXTENDED_PER_WEEK) continue;

            // Usa l'eccezione ADR: estende da 9h a 10h
            livignoDriverHours.set(driverId, 0); // Consuma tutta la giornata
            livignoAdrExceptions.set(driverId, usedExceptions + 1);
            emptyTrailers--;
            emptyTanks--;
            pendingFullTrailers++;
            pendingFullTanks++;
            totalLivignoSupply++;
            livignoSuppliesDone++;
            suppliesDone++;
          }
        }
      }

      // Le risorse SUPPLY arrivano (disponibili per il pomeriggio)
      fullTrailers += pendingFullTrailers;
      fullTanks += pendingFullTanks;
      // Le motrici tornano (solo quelle usate da driver Tirano, i driver Livigno riportano la motrice a Tirano)
      emptyTanks += suppliesDone;

      // =====================================================================
      // FASE 2: SHUTTLE e TRANSFER (driver Tirano e Livigno in parallelo)
      // =====================================================================
      // I driver Livigno possono SOLO fare SHUTTLE (consumano fullTanks)
      // I driver Tirano possono fare SHUTTLE, TRANSFER, FULL_ROUND
      let madeProgress = true;
      let iterations = 0;

      while (madeProgress && iterations < 100) {
        madeProgress = false;
        iterations++;

        // Prima i driver Livigno: possono solo fare SHUTTLE
        const availableLivignoDrivers = Array.from(livignoDriverHours.entries())
          .filter(([, h]) => h >= HOURS_SHUTTLE)
          .sort((a, b) => b[1] - a[1]);

        for (const [driverId, hoursLeft] of availableLivignoDrivers) {
          // Driver Livigno: SHUTTLE "inverso" (scende a Tirano, prende motrice piena, torna)
          // Consuma fullTanks (cisterna piena a Tirano)
          if (fullTanks > 0 && hoursLeft >= HOURS_SHUTTLE) {
            fullTanks--;
            emptyTanks++; // La motrice torna vuota a Tirano
            livignoDriverHours.set(driverId, hoursLeft - HOURS_SHUTTLE);
            totalLivignoShuttle++;
            litersToday += LITERS_PER_INTEGRATED_TANK;
            madeProgress = true;
            break;
          }
        }

        if (madeProgress) continue;

        // Poi driver Tirano: SHUTTLE, TRANSFER, FULL_ROUND
        const availableTiranoDrivers = Array.from(tiranoDriverHours.entries())
          .filter(([, h]) => h >= HOURS_TRANSFER)
          .sort((a, b) => b[1] - a[1]);

        if (availableTiranoDrivers.length === 0) break;

        for (const [driverId, hoursLeft] of availableTiranoDrivers) {
          // PRIORITÀ 1: SHUTTLE
          if (fullTanks > 0 && hoursLeft >= HOURS_SHUTTLE) {
            fullTanks--;
            emptyTanks++;
            tiranoDriverHours.set(driverId, hoursLeft - HOURS_SHUTTLE);
            totalShuttle++;
            litersToday += LITERS_PER_INTEGRATED_TANK;
            madeProgress = true;
            break;
          }

          // PRIORITÀ 2: TRANSFER
          if (fullTrailers > 0 && emptyTanks > 0 && hoursLeft >= HOURS_TRANSFER) {
            fullTrailers--;
            emptyTrailers++;
            emptyTanks--;
            fullTanks++;
            tiranoDriverHours.set(driverId, hoursLeft - HOURS_TRANSFER);
            totalTransfer++;
            madeProgress = true;
            break;
          }

          // PRIORITÀ 3: FULL_ROUND
          if (hoursLeft >= HOURS_FULL_ROUND) {
            tiranoDriverHours.set(driverId, hoursLeft - HOURS_FULL_ROUND);
            totalFullRound++;
            litersToday += LITERS_PER_INTEGRATED_TANK;
            madeProgress = true;
            break;
          }
        }
      }

      totalLiters += litersToday;
      if (litersToday > 0) daysWithDeliveries++;
    }

    return {
      totalLiters,
      breakdown: {
        supplyTrips: totalSupply,
        transferTrips: totalTransfer,
        shuttleTrips: totalShuttle,
        fullRoundTrips: totalFullRound,
        livignoShuttles: totalLivignoShuttle,
        livignoSupplyTrips: totalLivignoSupply,
      },
      daysWithDeliveries,
    };
  };

  // =========================================================================
  // GARANZIA MONOTONICA
  // =========================================================================
  // Testiamo configurazioni con subset crescenti e prendiamo il MAX.
  // Include driver sia Tirano che Livigno.
  // =========================================================================

  let bestResult = calculateGlobalMaxV2(getDriversPerDay(undefined)); // Baseline: solo RESIDENT

  if (validDriverAvailability && validDriverAvailability.length > 0) {
    // Configurazione richiesta
    const requestedResult = calculateGlobalMaxV2(getDriversPerDay(validDriverAvailability));
    if (requestedResult.totalLiters > bestResult.totalLiters) {
      bestResult = requestedResult;
    }

    // Per ogni driver ON_CALL/EMERGENCY (Tirano o Livigno), prova con subset crescenti
    const allDrivers = [...tiranoDrivers, ...livignoDrivers];
    const residentDrivers = allDrivers.filter(d => d.type === 'RESIDENT');
    const nonResidentDrivers = allDrivers.filter(d => d.type !== 'RESIDENT');

    for (const onCallDriver of nonResidentDrivers) {
      const onCallAvail = validDriverAvailability.find(a => a.driverId === onCallDriver.id);
      if (!onCallAvail || onCallAvail.availableDates.length === 0) continue;

      const sortedDates = onCallAvail.availableDates.sort();

      for (let numOnCallDays = 1; numOnCallDays <= sortedDates.length; numOnCallDays++) {
        const subsetDates = sortedDates.slice(0, numOnCallDays);

        const testAvail: DriverAvailabilityInput[] = [
          ...residentDrivers.map(d => ({ driverId: d.id, availableDates: allDates })),
          { driverId: onCallDriver.id, availableDates: subsetDates },
        ];

        const testResult = calculateGlobalMaxV2(getDriversPerDay(testAvail));
        if (testResult.totalLiters > bestResult.totalLiters) {
          bestResult = testResult;
        }
      }
    }
  }

  return {
    maxLiters: bestResult.totalLiters,
    workingDays: workingDays.length,
    daysWithDeliveries: bestResult.daysWithDeliveries,
    breakdown: {
      livignoDriverShuttles: bestResult.breakdown.livignoShuttles,
      livignoSupplyTrips: bestResult.breakdown.livignoSupplyTrips,
      tiranoDriverShuttles: bestResult.breakdown.shuttleTrips,
      tiranoDriverFullRounds: bestResult.breakdown.fullRoundTrips,
      supplyTrips: bestResult.breakdown.supplyTrips,
      transferTrips: bestResult.breakdown.transferTrips,
    },
    dailyCapacity: bestResult.daysWithDeliveries > 0
      ? Math.floor(bestResult.totalLiters / bestResult.daysWithDeliveries)
      : 0,
    constraints: [],
  };
}
