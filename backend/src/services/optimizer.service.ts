import { PrismaClient, Driver, Vehicle, Trailer, Location, Schedule, TripType } from '@prisma/client';
import { validateSingleTrip, ADR_LIMITS } from './adrValidator.service.js';

// ============================================================================
// TIPI E COSTANTI
// ============================================================================

// Tempi fissi per operazioni (in minuti)
const LOADING_TIME_SUPPLY = 60;      // Tempo carico a Milano (motrice 17.500L + rimorchio 17.500L = 35.000L)
const LOADING_TIME_SINGLE = 30;      // Tempo carico a Milano (solo serbatoio integrato 17.500L)
const UNLOADING_TIME_LIVIGNO = 30;   // Tempo scarico a Livigno
const TRANSFER_TIME_TIRANO = 30;     // Tempo sversamento rimorchio→motrice

// ============================================================================
// CALCOLO DINAMICO DURATE DA ROTTE DB
// ============================================================================

interface RouteDurations {
  tiranoToMilano: number;   // minuti
  milanoToTirano: number;   // minuti
  tiranoToLivigno: number;  // minuti
  livignoToTirano: number;  // minuti
}

interface TripDurations {
  SHUTTLE_LIVIGNO: number;
  SUPPLY_MILANO_FROM_TIRANO: number;
  SUPPLY_MILANO_FROM_LIVIGNO: number;
  FULL_ROUND: number;
  TRANSFER_TIRANO: number;
  SHUTTLE_FROM_LIVIGNO: number;    // Driver Livigno con motrice a Livigno: 4.5h
  SUPPLY_FROM_LIVIGNO: number;     // Driver Livigno con motrice a Livigno: 10h
}

async function getRouteDurations(prisma: PrismaClient): Promise<RouteDurations> {
  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const milanoLocation = locations.find(l => l.type === 'SOURCE');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');

  if (!tiranoLocation || !milanoLocation || !livignoLocation) {
    throw new Error('Missing required locations (Milano, Tirano, Livigno)');
  }

  const routes = await prisma.route.findMany({ where: { isActive: true } });

  const findRoute = (fromId: string, toId: string): number => {
    const route = routes.find(r => r.fromLocationId === fromId && r.toLocationId === toId);
    if (!route) {
      throw new Error(`Route not found: ${fromId} → ${toId}`);
    }
    return route.durationMinutes;
  };

  return {
    tiranoToMilano: findRoute(tiranoLocation.id, milanoLocation.id),
    milanoToTirano: findRoute(milanoLocation.id, tiranoLocation.id),
    tiranoToLivigno: findRoute(tiranoLocation.id, livignoLocation.id),
    livignoToTirano: findRoute(livignoLocation.id, tiranoLocation.id),
  };
}

function calculateTripDurations(routes: RouteDurations): TripDurations {
  // SHUTTLE: Tirano → Livigno → scarico → Tirano
  // La motrice parte già piena (dopo TRANSFER), quindi solo scarico a Livigno
  const shuttleDuration = routes.tiranoToLivigno + UNLOADING_TIME_LIVIGNO + routes.livignoToTirano;

  // SUPPLY da Tirano: Tirano → Milano → carico (motrice + rimorchio) → Tirano
  const supplyFromTirano = routes.tiranoToMilano + LOADING_TIME_SUPPLY + routes.milanoToTirano;

  // SUPPLY da Livigno: Livigno → Tirano + SUPPLY standard + Tirano → Livigno
  const supplyFromLivigno = routes.livignoToTirano + supplyFromTirano + routes.tiranoToLivigno;

  // FULL_ROUND: Tirano → Milano → carico (solo cisterna) → Tirano → Livigno → scarico → Tirano
  const fullRound = routes.tiranoToMilano + LOADING_TIME_SINGLE + routes.milanoToTirano +
                    routes.tiranoToLivigno + UNLOADING_TIME_LIVIGNO + routes.livignoToTirano;

  // =========================================================================
  // NUOVI TIPI PER DRIVER LIVIGNO CON MOTRICE DEDICATA CHE RESTA A LIVIGNO
  // =========================================================================

  // SHUTTLE_FROM_LIVIGNO: Livigno → Tirano → TRANSFER → Tirano → Livigno (4.5h)
  // Il driver parte da Livigno con motrice vuota, va a Tirano, prende carburante
  // da un rimorchio pieno (TRANSFER), torna a Livigno con motrice piena, scarica.
  // Fasi: Livigno→Tirano (90min) + TRANSFER (30min) + Tirano→Livigno (120min) + Scarico (30min)
  const shuttleFromLivigno = routes.livignoToTirano + TRANSFER_TIME_TIRANO +
                             routes.tiranoToLivigno + UNLOADING_TIME_LIVIGNO;  // 90+30+120+30 = 270 min (4.5h)

  // SUPPLY_FROM_LIVIGNO: Livigno → Tirano → Milano → Tirano → Livigno (10h)
  // Il driver parte da Livigno, va a Tirano, aggancia rimorchio vuoto,
  // va a Milano, carica motrice+rimorchio, torna a Tirano, sgancia rimorchio pieno,
  // va a Livigno con motrice piena, scarica. Richiede eccezione ADR (max 2/settimana).
  // Fasi: Livigno→Tirano (90min) + Tirano→Milano (150min) + Carico (60min) +
  //       Milano→Tirano (150min) + Tirano→Livigno (120min) + Scarico (30min)
  const supplyFromLivignoNew = routes.livignoToTirano + routes.tiranoToMilano +
                               LOADING_TIME_SUPPLY + routes.milanoToTirano +
                               routes.tiranoToLivigno + UNLOADING_TIME_LIVIGNO;  // 90+150+60+150+120+30 = 600 min (10h)

  return {
    SHUTTLE_LIVIGNO: shuttleDuration,                    // 120 + 30 + 90 = 240 min (4h)
    SUPPLY_MILANO_FROM_TIRANO: supplyFromTirano,         // 150 + 60 + 150 = 360 min (6h)
    SUPPLY_MILANO_FROM_LIVIGNO: supplyFromLivigno,       // 90 + 360 + 120 = 570 min (9.5h)
    FULL_ROUND: fullRound,                               // 150 + 30 + 150 + 120 + 30 + 90 = 570 min (9.5h)
    TRANSFER_TIRANO: TRANSFER_TIME_TIRANO,               // 30 min
    SHUTTLE_FROM_LIVIGNO: shuttleFromLivigno,            // 90 + 30 + 120 + 30 = 270 min (4.5h)
    SUPPLY_FROM_LIVIGNO: supplyFromLivignoNew,           // 90 + 150 + 60 + 150 + 120 + 30 = 600 min (10h)
  };
}

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
      SHUTTLE_FROM_LIVIGNO: number;
      SUPPLY_FROM_LIVIGNO: number;
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
// Le motrici hanno una serbatoio integrato (17.500L, non staccabile) e possono
// trainare max 1 rimorchio. I rimorchi pieni NON salgono MAI a Livigno.
// Il trasferimento del carburante avviene tramite sversamento a Tirano.
// ============================================================================

// NOTA: Le durate viaggi sono ora calcolate dinamicamente dalla funzione
// calculateTripDurations() usando i dati delle rotte nel database.

// Litri consegnati a Livigno per tipo viaggio
const TRIP_LITERS = {
  SHUTTLE_LIVIGNO: 17500,       // Serbatoio integrato della motrice
  SUPPLY_MILANO: 35000,         // Motrice (17.500) + 1 rimorchio (17.500) - non consegna, riempie Tirano
  FULL_ROUND: 17500,            // Serbatoio integrato a Livigno
  TRANSFER_TIRANO: 17500,       // Sversamento rimorchio → serbatoio integrato
  SHUTTLE_FROM_LIVIGNO: 17500,  // Driver Livigno: serbatoio integrato consegnata a Livigno
  SUPPLY_FROM_LIVIGNO: 17500,   // Driver Livigno: serbatoio integrato + 1 rimorchio pieno lasciato a Tirano
};

// Rimorchi utilizzati per tipo viaggio
const TRIP_TRAILERS = {
  SHUTTLE_LIVIGNO: 0,       // Solo motrice sale (serbatoio integrato)
  SUPPLY_MILANO: 1,         // Motrice + 1 rimorchio vuoto → tornano pieni
  FULL_ROUND: 0,            // Solo motrice
  TRANSFER_TIRANO: 1,       // 1 rimorchio pieno viene sversato
  SHUTTLE_FROM_LIVIGNO: 1,  // Consuma 1 rimorchio pieno a Tirano (diventa vuoto)
  SUPPLY_FROM_LIVIGNO: 1,   // Usa 1 rimorchio vuoto a Tirano (torna pieno)
};

const LITERS_PER_TRAILER = 17500;
const LITERS_PER_INTEGRATED_TANK = 17500;
const DEFAULT_DEPARTURE_HOUR = 6;
const MAX_DAILY_HOURS = 9; // ADR limit
const MAX_SHUTTLE_PER_DAY_LIVIGNO_DRIVER = 3;

// ============================================================================
// STATO RIMORCHI
// ============================================================================

// Stato RIMORCHI (staccabili, base Tirano)
interface TrailerState {
  atTiranoFull: Set<string>;   // ID rimorchi pieni a Tirano (da sversare)
  atTiranoEmpty: Set<string>;  // ID rimorchi vuoti a Tirano (per SUPPLY)
  atMilano: Set<string>;       // ID rimorchi a Milano (sorgente)
  inTransit: Set<string>;      // ID rimorchi in viaggio
}

// Stato MOTRICI (serbatoio integrato)
interface VehicleTankState {
  tankFull: Map<string, boolean>;      // vehicleId → serbatoio integrato piena/vuota
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
  vehicleTankState: VehicleTankState;        // Stato serbatoi integrati motrici
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

  // Calcola durate viaggi dinamicamente dalle rotte nel DB
  const routeDurations = await getRouteDurations(prisma);
  const TRIP_DURATIONS = calculateTripDurations(routeDurations);

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

  // Initialize VEHICLE TANK state (serbatoio integrato)
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
      // Default: serbatoio integrato vuota, posizione = base della motrice
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
  const tripsByType = {
    SHUTTLE_LIVIGNO: 0,
    SUPPLY_MILANO: 0,
    FULL_ROUND: 0,
    TRANSFER_TIRANO: 0,
    SHUTTLE_FROM_LIVIGNO: 0,
    SUPPLY_FROM_LIVIGNO: 0,
  };

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

      // Trova initialAdrExceptions per questo driver se fornito
      const driverInput = driverAvailability?.find(da => da.driverId === d.id);
      const initialExceptions = driverInput?.initialAdrExceptions ?? 0;

      // Usa valore iniziale fornito + eventuali eccezioni già tracciate in questa ottimizzazione
      const extendedDays = initialExceptions + (tracker.driverHoursByWeek.get(`${weekKey}-extended`) || 0);

      driverState.set(d.id, {
        nextAvailable: startOfDay,
        hoursWorked: tracker.driverHoursByDate.get(`${d.id}-${dateKey}`) || 0,
        extendedDaysThisWeek: extendedDays,
      });
    }

    // Track when trailers become available (after SUPPLY returns)
    // Key: trailerId, Value: time when it becomes full at Tirano
    const trailerAvailableAt = new Map<string, Date>();

    // Track when trailers become EMPTY (during SHUTTLE_FROM_LIVIGNO, after TRANSFER at Tirano)
    // Key: trailerId, Value: time when it becomes empty at Tirano
    const trailerEmptyAvailableAt = new Map<string, Date>();

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

    // =========================================================================
    // PRE-FASE: CALCOLA DRIVER TIRANO "IN ECCESSO" CHE DEVONO FARE SUPPLY
    // =========================================================================
    // Calcola quanti rimorchi pieni possiamo effettivamente consumare oggi:
    // - Driver Livigno con motrice a Livigno: consumano rimorchi con SHUTTLE_FROM_LIVIGNO
    // - Driver Tirano: consumano rimorchi con cicli (TRANSFER + SHUTTLE)
    //
    // Se ci sono più driver Tirano di quanti cicli possiamo fare,
    // i driver "in eccesso" dovrebbero fare SUPPLY invece di TRANSFER.
    // =========================================================================

    const fullTrailersToday = tracker.trailerState.atTiranoFull.size;

    // Conta quante motrici ci sono a Livigno (risorsa condivisa tra driver Livigno)
    let vehiclesAtLivignoCount = 0;
    for (const v of vehicles) {
      const location = tracker.vehicleTankState.location.get(v.id);
      if (location === livignoLocation.id) {
        vehiclesAtLivignoCount++;
      }
    }

    // Calcola quanti rimorchi pieni possono consumare i driver Livigno
    // NOTA: I driver Livigno condividono le motrici a Livigno, quindi il consumo
    // è limitato dal numero di motrici disponibili, non dal numero di driver.
    const shuttleFromLivignoHoursCalc = TRIP_DURATIONS.SHUTTLE_FROM_LIVIGNO / 60; // 4.5h
    const shuttlesPerVehiclePerDay = Math.floor(MAX_DAILY_HOURS / shuttleFromLivignoHoursCalc); // ~2 shuttle/giorno per motrice

    // Calcola ore totali disponibili dei driver Livigno
    let livignoDriverTotalHours = 0;
    for (const d of livignoDriversToday) {
      const state = driverState.get(d.id);
      if (!state) continue;
      const hoursLeft = (state.extendedDaysThisWeek < 2 ? 10 : MAX_DAILY_HOURS) - state.hoursWorked;
      livignoDriverTotalHours += hoursLeft;
    }

    // Il consumo è il MINIMO tra:
    // 1. Shuttle possibili con le motrici disponibili a Livigno
    // 2. Shuttle possibili con le ore totali dei driver Livigno
    const shuttlesFromVehicles = vehiclesAtLivignoCount * shuttlesPerVehiclePerDay;
    const shuttlesFromDriverHours = Math.floor(livignoDriverTotalHours / shuttleFromLivignoHoursCalc);
    const livignoConsumption = Math.min(shuttlesFromVehicles, shuttlesFromDriverHours);

    // Rimorchi pieni rimanenti per driver Tirano
    const fullTrailersForTirano = Math.max(0, fullTrailersToday - livignoConsumption);

    // Calcola quanti cicli (TRANSFER + SHUTTLE) può fare ogni driver Tirano in una giornata
    const cycleHours = (TRIP_DURATIONS.TRANSFER_TIRANO + TRIP_DURATIONS.SHUTTLE_LIVIGNO) / 60; // ~4.5h
    const cyclesPerDriver = Math.floor(MAX_DAILY_HOURS / cycleHours); // ~2 cicli per driver

    // Quanti driver Tirano servono per consumare tutti i rimorchi pieni disponibili?
    const tiranoDriversNeeded = cyclesPerDriver > 0
      ? Math.ceil(fullTrailersForTirano / cyclesPerDriver)
      : 0;

    // Driver Tirano "in eccesso" = dovrebbero fare SUPPLY invece di TRANSFER
    // Ordina per priorità (RESIDENT prima) e marca quelli in eccesso
    const sortedTiranoDrivers = [...tiranoDriversToday].sort((a, b) => {
      const priority: Record<string, number> = { RESIDENT: 0, ON_CALL: 1, EMERGENCY: 2 };
      return priority[a.type] - priority[b.type];
    });

    const excessTiranoDrivers = new Set<string>();
    sortedTiranoDrivers.forEach((d, index) => {
      if (index >= tiranoDriversNeeded) {
        excessTiranoDrivers.add(d.id);
      }
    });

    // Log per debug (può essere rimosso in produzione)
    if (excessTiranoDrivers.size > 0) {
      warnings.push(
        `Giorno ${dateKey}: ${excessTiranoDrivers.size} driver Tirano in eccesso → assegnati a SUPPLY ` +
        `(rimorchi pieni: ${fullTrailersToday}, consumo Livigno: ${livignoConsumption}, ` +
        `rimanenti per Tirano: ${fullTrailersForTirano}, driver Tirano necessari: ${tiranoDriversNeeded})`
      );
    }

    // Keep scheduling until no more trips possible
    let madeProgress = true;
    let iterations = 0;
    const maxIterations = 100;

    while (madeProgress && remainingLiters > 0 && iterations < maxIterations) {
      madeProgress = false;
      iterations++;

      // Conta risorse disponibili ORA
      const fullTrailersAtTirano = tracker.trailerState.atTiranoFull.size;
      // emptyTrailersAtTirano verrà calcolato dopo per ogni driver considerando il suo availableTime

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

        // Conta rimorchi VUOTI disponibili (inclusi quelli che diventeranno vuoti dopo SHUTTLE_FROM_LIVIGNO)
        let emptyTrailersAtTirano = tracker.trailerState.atTiranoEmpty.size;
        let pendingEmptyTrailers: { id: string; availableAt: Date }[] = [];

        for (const [trailerId, emptyAt] of trailerEmptyAvailableAt) {
          if (emptyAt <= availableTime) {
            emptyTrailersAtTirano++;
            // Aggiorna il tracker per riflettere che il rimorchio è ora vuoto
            tracker.trailerState.atTiranoEmpty.add(trailerId);
            trailerEmptyAvailableAt.delete(trailerId);
          } else {
            pendingEmptyTrailers.push({ id: trailerId, availableAt: emptyAt });
          }
        }

        // Conta motrici con serbatoio integrato piena a Tirano
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

        // Controlla serbatoi integrati in arrivo (dopo TRANSFER)
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
        const shuttleHours = TRIP_DURATIONS.SHUTTLE_LIVIGNO / 60; // 4.5h (Tirano-based)
        const transferHours = TRIP_DURATIONS.TRANSFER_TIRANO / 60; // 0.5h

        // Durate per driver Livigno con motrice dedicata a Livigno
        const shuttleFromLivignoHours = TRIP_DURATIONS.SHUTTLE_FROM_LIVIGNO / 60; // 4.5h
        const supplyFromLivignoHours = TRIP_DURATIONS.SUPPLY_FROM_LIVIGNO / 60; // 10h

        const hoursUntilEndOfDay = (endOfWorkDay.getTime() - availableTime.getTime()) / (1000 * 60 * 60);
        const hoursRemaining = maxHoursToday - state.hoursWorked;
        const canDoSupply = hoursRemaining >= supplyHours && hoursUntilEndOfDay >= supplyHours;
        const canDoShuttle = hoursRemaining >= shuttleHours && hoursUntilEndOfDay >= shuttleHours;
        const canDoTransfer = hoursRemaining >= transferHours && hoursUntilEndOfDay >= transferHours;
        const canDoFullRound = hoursRemaining >= 9 && hoursUntilEndOfDay >= 9;

        // Capacità per driver Livigno con motrice a Livigno
        const canDoShuttleFromLivigno = hoursRemaining >= shuttleFromLivignoHours && hoursUntilEndOfDay >= shuttleFromLivignoHours;
        const canDoSupplyFromLivigno = hoursRemaining >= supplyFromLivignoHours && hoursUntilEndOfDay >= supplyFromLivignoHours;

        // Controlla se il driver Livigno ha una motrice dedicata A LIVIGNO
        let hasVehicleAtLivigno = false;
        let vehicleAtLivignoId: string | null = null;
        if (isLivignoDriver) {
          for (const v of vehicles) {
            const location = tracker.vehicleTankState.location.get(v.id);
            if (location === livignoLocation.id &&
                isResourceAvailable(v.id, availableTime, endOfWorkDay, tracker.vehicleTimeSlots)) {
              hasVehicleAtLivigno = true;
              vehicleAtLivignoId = v.id;
              break;
            }
          }
        }

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

        // =========================================================================
        // ALGORITMO DECISIONALE
        // =========================================================================
        // Caso speciale: Driver Livigno con motrice dedicata CHE RESTA A LIVIGNO
        // Questi driver usano SHUTTLE_FROM_LIVIGNO e SUPPLY_FROM_LIVIGNO
        // La loro motrice non scende mai definitivamente a Tirano.
        // =========================================================================

        if (isLivignoDriver && hasVehicleAtLivigno) {
          // DRIVER LIVIGNO CON MOTRICE A LIVIGNO
          // Priorità: SHUTTLE_FROM_LIVIGNO > SUPPLY_FROM_LIVIGNO > attesa

          if (fullTrailersAvailable >= 1 && canDoShuttleFromLivigno) {
            // Ci sono rimorchi pieni a Tirano: può fare SHUTTLE_FROM_LIVIGNO
            // Il driver scende a Tirano, fa TRANSFER, risale con motrice piena
            tripType = 'SHUTTLE_FROM_LIVIGNO';
            tripDurationMinutes = TRIP_DURATIONS.SHUTTLE_FROM_LIVIGNO;
          }
          else if (emptyTrailersAtTirano >= 1 && canDoSupplyFromLivigno && state.extendedDaysThisWeek < 2) {
            // Non ci sono rimorchi pieni, ma ci sono rimorchi vuoti: SUPPLY_FROM_LIVIGNO
            // Richiede eccezione ADR (10h), max 2 volte/settimana
            tripType = 'SUPPLY_FROM_LIVIGNO';
            tripDurationMinutes = TRIP_DURATIONS.SUPPLY_FROM_LIVIGNO;
          }
          else if (pendingFullTrailers.length > 0) {
            // Aspetta rimorchi pieni in arrivo (altri driver stanno facendo SUPPLY)
            const nextTrailer = pendingFullTrailers.sort((a, b) =>
              a.availableAt.getTime() - b.availableAt.getTime()
            )[0];
            if (nextTrailer) {
              waitUntil = nextTrailer.availableAt;
            }
          }
          // Se non può fare nulla, questo driver aspetta o la giornata finisce
        }
        else {
          // DRIVER TIRANO (o Livigno senza motrice dedicata a Livigno)
          // Priorità: SHUTTLE > TRANSFER > SUPPLY > FULL_ROUND
          //
          // ECCEZIONE: Driver "in eccesso" fanno SUPPLY invece di TRANSFER
          // perché i rimorchi pieni verranno già consumati dagli altri driver.

          // Driver in eccesso: priorità a SUPPLY se ci sono rimorchi vuoti
          // Se non può fare SUPPLY, aspetta (non deve "rubare" TRANSFER agli altri driver)
          if (excessTiranoDrivers.has(driver.id)) {
            if (emptyTrailersAtTirano >= 1 && canDoSupply) {
              tripType = 'SUPPLY_MILANO';
              tripDurationMinutes = supplyDuration;
            } else if (pendingEmptyTrailers.length > 0 && canDoSupply) {
              // Ci sono rimorchi che diventeranno vuoti presto (dopo SHUTTLE_FROM_LIVIGNO in corso)
              // Aspetta fino a quando il primo rimorchio diventa vuoto
              const nextEmpty = pendingEmptyTrailers.sort((a, b) =>
                a.availableAt.getTime() - b.availableAt.getTime()
              )[0];
              if (nextEmpty && nextEmpty.availableAt < endOfWorkDay) {
                // Verifica che abbia ancora tempo per fare SUPPLY dopo l'attesa
                const waitTime = (nextEmpty.availableAt.getTime() - availableTime.getTime()) / (1000 * 60 * 60);
                if (state.hoursWorked + waitTime + supplyHours <= maxHoursToday) {
                  state.nextAvailable = nextEmpty.availableAt;
                  madeProgress = true;
                }
              }
              continue;
            } else {
              // Non può fare SUPPLY ora e non ci sono rimorchi in arrivo
              // Il loop while(madeProgress) ri-itererà quando ci saranno risorse
              continue;
            }
          }
          else if (vehiclesWithFullTankAtTirano >= 1 && canDoShuttle) {
            tripType = 'SHUTTLE_LIVIGNO';
            tripDurationMinutes = TRIP_DURATIONS.SHUTTLE_LIVIGNO;
          }
          else if (vehiclesWithEmptyTankAtTirano >= 1 && fullTrailersAvailable >= 1 && canDoTransfer && !isLivignoDriver) {
            // Driver Livigno non possono fare TRANSFER (parte da Tirano)
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
          // Trova motrice con serbatoio integrato PIENA a Tirano
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

            // La motrice sale a Livigno con serbatoio integrato piena, torna vuota
            tripTrailers = []; // Nessun rimorchio per SHUTTLE!

            // Aggiorna stato: serbatoio integrato da piena a vuota, posizione rimane Tirano
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);

            remainingLiters -= TRIP_LITERS.SHUTTLE_LIVIGNO;
            tripsByType.SHUTTLE_LIVIGNO++;
            success = true;
          }
        } else if (tripType === 'TRANSFER_TIRANO') {
          // Trova motrice con serbatoio integrato VUOTA a Tirano
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

            // Aggiorna stato: rimorchio da pieno a vuoto, serbatoio integrato da vuota a piena
            // Il rimorchio diventa VUOTO solo alla fine del TRANSFER (returnTime), non subito!
            tracker.trailerState.atTiranoFull.delete(trailerId);
            trailerEmptyAvailableAt.set(trailerId, returnTime);
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

            // La serbatoio integrato sarà piena al ritorno
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
        } else if (tripType === 'SHUTTLE_FROM_LIVIGNO') {
          // =========================================================================
          // SHUTTLE_FROM_LIVIGNO: Driver Livigno con motrice a Livigno (4.5h)
          // =========================================================================
          // Fasi:
          // 1. Livigno → Tirano (90 min) con motrice vuota
          // 2. TRANSFER: rimorchio pieno → serbatoio integrato (30 min)
          // 3. Tirano → Livigno (120 min) con motrice piena
          // 4. Scarico a Livigno (30 min)
          // La motrice RESTA A LIVIGNO!
          // =========================================================================

          // Trova la motrice a Livigno (già identificata in vehicleAtLivignoId)
          vehicle = vehicleAtLivignoId ? vehicles.find(v => v.id === vehicleAtLivignoId) || null : null;

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
              isPickup: true, // Il rimorchio viene usato per sversamento
              dropOffLocationId: tiranoLocation.id, // Rimane a Tirano (vuoto)
            }];

            // Aggiorna stato rimorchio:
            // Il rimorchio diventa VUOTO dopo: Livigno→Tirano (90min) + TRANSFER (30min) = 120min
            // NON subito alla fine del viaggio!
            tracker.trailerState.atTiranoFull.delete(trailerId);
            const trailerEmptyTime = new Date(departureTime);
            trailerEmptyTime.setMinutes(trailerEmptyTime.getMinutes() + routeDurations.livignoToTirano + TRANSFER_TIME_TIRANO);
            trailerEmptyAvailableAt.set(trailerId, trailerEmptyTime);

            // - Serbatoio integrato: vuota (ha scaricato a Livigno)
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);

            // - CRUCIALE: la motrice RESTA A LIVIGNO!
            tracker.vehicleTankState.location.set(vehicle.id, livignoLocation.id);

            remainingLiters -= TRIP_LITERS.SHUTTLE_FROM_LIVIGNO;
            tripsByType.SHUTTLE_FROM_LIVIGNO++;
            success = true;
          }
        } else if (tripType === 'SUPPLY_FROM_LIVIGNO') {
          // =========================================================================
          // SUPPLY_FROM_LIVIGNO: Driver Livigno con motrice a Livigno (10h, eccezione ADR)
          // =========================================================================
          // Fasi:
          // 1. Livigno → Tirano (90 min) con motrice vuota
          // 2. Aggancio rimorchio vuoto
          // 3. Tirano → Milano (150 min)
          // 4. Carico (motrice + rimorchio) (60 min) = 35.000L totali
          // 5. Milano → Tirano (150 min)
          // 6. Sgancio rimorchio PIENO a Tirano
          // 7. Tirano → Livigno (120 min) con motrice piena
          // 8. Scarico a Livigno (30 min)
          // La motrice RESTA A LIVIGNO con 17.500L consegnati!
          // Il rimorchio pieno resta a Tirano per altri SHUTTLE.
          // =========================================================================

          // Trova la motrice a Livigno
          vehicle = vehicleAtLivignoId ? vehicles.find(v => v.id === vehicleAtLivignoId) || null : null;

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
              dropOffLocationId: tiranoLocation.id, // Torna PIENO a Tirano
            }];

            // Aggiorna stato:
            // - Rimorchio: da vuoto a pieno a Tirano (sarà disponibile al ritorno)
            tracker.trailerState.atTiranoEmpty.delete(trailerId);
            trailerAvailableAt.set(trailerId, returnTime); // Sarà pieno quando il viaggio finisce

            // - Serbatoio integrato: vuota (ha scaricato a Livigno)
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);

            // - CRUCIALE: la motrice RESTA A LIVIGNO!
            tracker.vehicleTankState.location.set(vehicle.id, livignoLocation.id);

            remainingLiters -= TRIP_LITERS.SUPPLY_FROM_LIVIGNO;
            tripsByType.SUPPLY_FROM_LIVIGNO++;
            success = true;
          }
        } else if (tripType === 'FULL_ROUND') {
          // FULL_ROUND: motrice va a Milano, carica serbatoio integrato, consegna a Livigno
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

            // La serbatoio integrato viene usata per il giro completo
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

    // End of day: move all pending empty trailers to empty
    for (const [trailerId] of trailerEmptyAvailableAt) {
      tracker.trailerState.atTiranoEmpty.add(trailerId);
    }
    trailerEmptyAvailableAt.clear();

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

  // Calcola litri effettivamente consegnati a Livigno (non litri movimentati)
  const totalLitersDelivered = generatedTrips.reduce((sum, trip) => {
    // Solo questi tipi consegnano effettivamente a Livigno
    const deliveryTypes: TripType[] = [
      'SHUTTLE_LIVIGNO',
      'FULL_ROUND',
      'SHUTTLE_FROM_LIVIGNO',
      'SUPPLY_FROM_LIVIGNO',
    ];
    if (deliveryTypes.includes(trip.tripType)) {
      return sum + TRIP_LITERS[trip.tripType];
    }
    // SUPPLY_MILANO e TRANSFER_TIRANO non consegnano a Livigno
    return sum;
  }, 0);

  const trailersAtParking = tracker.trailerState.atTiranoFull.size + tracker.trailerState.atTiranoEmpty.size;

  return {
    success: remainingLiters <= 0,
    trips: generatedTrips,
    warnings,
    statistics: {
      totalTrips: generatedTrips.length,
      totalLiters: totalLitersDelivered,
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
    // Nuovi tipi per driver Livigno con motrice dedicata a Livigno
    shuttleFromLivigno: number; // SHUTTLE_FROM_LIVIGNO (4.5h)
    supplyFromLivigno: number;  // SUPPLY_FROM_LIVIGNO (10h)
    // Tracciamento eccezioni ADR
    adrExceptionsUsed: number;  // Totale eccezioni ADR usate (10h invece di 9h)
  };
  dailyCapacity: number; // maxLiters / daysWithDeliveries
  constraints: string[];
}

export interface DriverAvailabilityInput {
  driverId: string;
  availableDates: string[]; // Array di date YYYY-MM-DD
  initialAdrExceptions?: number;  // 0, 1 o 2
}

export interface CalculateMaxInput {
  startDate: string | Date;
  endDate: string | Date;
  initialStates?: {
    trailerId: string;
    locationId: string;
    isFull: boolean;
  }[];
  vehicleStates?: {
    vehicleId: string;
    locationId: string;
    isTankFull: boolean;
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

  // Calcola durate viaggi dinamicamente dalle rotte nel DB
  const routeDurations = await getRouteDurations(prisma);
  const tripDurations = calculateTripDurations(routeDurations);

  // Converti minuti in ore per l'algoritmo
  const HOURS_SUPPLY = tripDurations.SUPPLY_MILANO_FROM_TIRANO / 60;
  const HOURS_SUPPLY_LIVIGNO = tripDurations.SUPPLY_MILANO_FROM_LIVIGNO / 60;
  const HOURS_TRANSFER = tripDurations.TRANSFER_TIRANO / 60;
  const HOURS_SHUTTLE = tripDurations.SHUTTLE_LIVIGNO / 60;
  const HOURS_FULL_ROUND = tripDurations.FULL_ROUND / 60;
  const HOURS_SHUTTLE_FROM_LIVIGNO = tripDurations.SHUTTLE_FROM_LIVIGNO / 60;  // 4.5h
  const HOURS_SUPPLY_FROM_LIVIGNO = tripDurations.SUPPLY_FROM_LIVIGNO / 60;    // 10h
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

  // Calcola stato iniziale motrici da vehicleStates
  // Le motrici a Tirano con isTankFull=true sono risorse disponibili immediatamente
  // Le motrici a Livigno sono disponibili per SHUTTLE_FROM_LIVIGNO e SUPPLY_FROM_LIVIGNO
  let initialFullTanksAtTirano = 0;
  let initialVehiclesAtLivigno = 0;
  const numVehiclesAtLivigno = vehicles.filter(v => v.baseLocationId === livignoLocation.id).length;

  if (input.vehicleStates && input.vehicleStates.length > 0) {
    for (const vs of input.vehicleStates) {
      if (vs.locationId === tiranoLocation.id && vs.isTankFull) {
        initialFullTanksAtTirano++;
      } else if (vs.locationId === livignoLocation.id) {
        initialVehiclesAtLivigno++;
      }
    }
  } else {
    // Default: motrici con base Livigno sono a Livigno
    initialVehiclesAtLivigno = numVehiclesAtLivigno;
  }

  // Calcola stato iniziale rimorchi da initialStates
  // I rimorchi pieni a Tirano sono disponibili per TRANSFER immediatamente
  let initialFullTrailers = 0;
  if (input.initialStates && input.initialStates.length > 0) {
    for (const ts of input.initialStates) {
      // Conta solo rimorchi pieni a Tirano
      if (ts.isFull && ts.locationId === tiranoLocation.id) {
        initialFullTrailers++;
      }
    }
  }

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
      shuttleFromLivigno: number;
      supplyFromLivigno: number;
      adrExceptionsUsed: number;
    };
    daysWithDeliveries: number;
  } => {
    const { tirano: tiranoPerDay, livigno: livignoPerDay } = driversData;
    const numDays = tiranoPerDay.length;
    if (numDays === 0) {
      return {
        totalLiters: 0,
        breakdown: {
          supplyTrips: 0,
          transferTrips: 0,
          shuttleTrips: 0,
          fullRoundTrips: 0,
          livignoShuttles: 0,
          livignoSupplyTrips: 0,
          shuttleFromLivigno: 0,
          supplyFromLivigno: 0,
          adrExceptionsUsed: 0,
        },
        daysWithDeliveries: 0,
      };
    }

    // Stato risorse (condivise tra tutti i driver)
    // Inizializza con stato iniziale: motrici e rimorchi già pieni a Tirano sono disponibili subito
    let fullTrailers = initialFullTrailers;
    let emptyTrailers = numTrailers - initialFullTrailers;
    let fullTanksAtTirano = initialFullTanksAtTirano;
    let emptyTanksAtTirano = numVehicles - initialFullTanksAtTirano - initialVehiclesAtLivigno;
    let vehiclesAtLivigno = initialVehiclesAtLivigno;

    // Contatori totali
    let totalLiters = 0;
    let totalSupply = 0;
    let totalTransfer = 0;
    let totalShuttle = 0;
    let totalFullRound = 0;
    let totalLivignoShuttle = 0;
    let totalLivignoSupply = 0;
    let totalShuttleFromLivigno = 0;
    let totalSupplyFromLivigno = 0;
    let daysWithDeliveries = 0;

    // Traccia eccezioni ADR usate (max 2/settimana per driver)
    // Resettiamo ogni 5 giorni lavorativi (approssimazione settimana)
    const livignoAdrExceptions = new Map<string, number>();
    const tiranoAdrExceptions = new Map<string, number>();
    let totalAdrExceptionsUsed = 0;

    for (let day = 0; day < numDays; day++) {
      const tiranoDriversToday = tiranoPerDay[day];
      const livignoDriversToday = livignoPerDay[day];
      const remainingDays = numDays - day;
      const isLastDay = remainingDays === 1;

      // Reset eccezioni ADR ogni 5 giorni (nuova settimana lavorativa)
      if (day > 0 && day % 5 === 0) {
        livignoAdrExceptions.clear();
        tiranoAdrExceptions.clear();
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

      // =====================================================================
      // STEP 1: SUPPLY+SHUTTLE combo per driver Tirano (PRIMA di SUPPLY standard)
      // =====================================================================
      // Calcolo basato su risorse INIZIALI del giorno.
      // Se non ci sono abbastanza risorse per 2 SHUTTLE per ogni driver,
      // alcuni driver fanno SUPPLY+SHUTTLE combo (10h, 1 ADR) per:
      // - Produrre 1 rimorchio pieno
      // - Consegnare 17.500L
      // Questo è meglio di SUPPLY standard (6h, 0L) + 3h inutilizzate.
      const initialResourcesForShuttle = fullTanksAtTirano + fullTrailers;
      const tiranoDriversWithFullHours = Array.from(tiranoDriverHours.values()).filter(h => h >= MAX_DAILY_HOURS).length;
      // Ogni risorsa piena = 1 SHUTTLE, ogni driver con 9h può fare max 2 SHUTTLE
      const shuttlesPossibleWithInitialResources = Math.min(initialResourcesForShuttle, tiranoDriversWithFullHours * 2);
      // Driver che non possono fare 2 SHUTTLE con le risorse iniziali
      const driversNeedingCombo = Math.max(0, tiranoDriversWithFullHours - Math.floor(shuttlesPossibleWithInitialResources / 2));

      // Per ogni driver che non ha risorse per 2 SHUTTLE, fare SUPPLY+SHUTTLE combo
      if (driversNeedingCombo > 0 && emptyTrailers > 0 && emptyTanksAtTirano > 0) {
        let combosDone = 0;
        for (const [driverId, hoursLeft] of tiranoDriverHours) {
          if (combosDone >= driversNeedingCombo) break;
          if (hoursLeft < MAX_DAILY_HOURS) continue;
          if (emptyTrailers <= 0) break;
          if (emptyTanksAtTirano <= 0) break;

          const tiranoUsedExceptions = tiranoAdrExceptions.get(driverId) || 0;
          if (tiranoUsedExceptions >= MAX_ADR_EXTENDED_PER_WEEK) continue;

          // SUPPLY+SHUTTLE combo
          emptyTrailers--;
          emptyTanksAtTirano--;
          pendingFullTrailers++;  // Rimorchio torna pieno
          // Motrice torna vuota dopo SHUTTLE (non pendingFullTanks)

          tiranoDriverHours.set(driverId, 0);
          tiranoAdrExceptions.set(driverId, tiranoUsedExceptions + 1);
          totalAdrExceptionsUsed++;
          totalSupply++;
          totalShuttle++;
          suppliesDone++;
          combosDone++;
          litersToday += LITERS_PER_INTEGRATED_TANK;
        }
      }

      // =====================================================================
      // STEP 2: SUPPLY standard per driver Tirano (DOPO combo)
      // =====================================================================
      // I driver che non hanno fatto combo possono fare SUPPLY standard (6h)
      // per produrre risorse per domani. Ma avranno solo 3h rimaste, non abbastanza per SHUTTLE.
      // NOTA: Driver Livigno è gestito nella FASE 2 (dinamicamente decide SHUTTLE vs SUPPLY).
      if (!isLastDay) {
        const tomorrowTiranoDrivers = tiranoPerDay[day + 1] || [];
        const tomorrowLivignoDrivers = livignoPerDay[day + 1] || [];
        const tomorrowTiranoHours = tomorrowTiranoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
        const tomorrowLivignoHours = tomorrowLivignoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
        const tomorrowShuttlePotential = Math.floor(tomorrowTiranoHours / HOURS_SHUTTLE) +
                                         Math.floor(tomorrowLivignoHours / HOURS_SHUTTLE);
        const currentResources = fullTanksAtTirano + fullTrailers + pendingFullTrailers + pendingFullTanks;
        const resourcesNeeded = Math.max(0, tomorrowShuttlePotential - currentResources);
        const suppliesWanted = Math.ceil(resourcesNeeded / 2);

        for (const [driverId, hoursLeft] of tiranoDriverHours) {
          if (suppliesDone >= suppliesWanted) break;
          if (hoursLeft < HOURS_SUPPLY) continue;
          if (emptyTrailers <= 0) break;
          if (emptyTanksAtTirano <= 0) break;

          tiranoDriverHours.set(driverId, hoursLeft - HOURS_SUPPLY);
          emptyTrailers--;
          emptyTanksAtTirano--;
          pendingFullTrailers++;
          pendingFullTanks++;
          totalSupply++;
          suppliesDone++;
        }
      }

      // Le risorse SUPPLY arrivano (disponibili per il pomeriggio)
      fullTrailers += pendingFullTrailers;
      fullTanksAtTirano += pendingFullTanks;
      // Le motrici tornano a Tirano (solo quelle usate da driver Tirano)
      // NOTA: il driver Livigno NON riporta la motrice a Tirano - resta a Livigno
      emptyTanksAtTirano += (suppliesDone - livignoSuppliesDone);

      // =====================================================================
      // FASE 2: SHUTTLE e TRANSFER (driver Tirano e Livigno in parallelo)
      // =====================================================================
      // Driver Livigno con motrice a Livigno: SHUTTLE_FROM_LIVIGNO o SUPPLY_FROM_LIVIGNO
      // Driver Livigno senza motrice a Livigno: SHUTTLE standard (consuma fullTanksAtTirano)
      // Driver Tirano: SHUTTLE, TRANSFER, FULL_ROUND
      let madeProgress = true;
      let iterations = 0;

      while (madeProgress && iterations < 100) {
        madeProgress = false;
        iterations++;

        // Prima i driver Livigno con motrice a Livigno: SHUTTLE_FROM_LIVIGNO
        // Consuma 1 rimorchio pieno a Tirano, motrice resta a Livigno
        if (vehiclesAtLivigno > 0) {
          const availableLivignoDriversWithVehicle = Array.from(livignoDriverHours.entries())
            .filter(([, h]) => h >= HOURS_SHUTTLE_FROM_LIVIGNO)
            .sort((a, b) => b[1] - a[1]);

          for (const [driverId, hoursLeft] of availableLivignoDriversWithVehicle) {
            // SHUTTLE_FROM_LIVIGNO: consuma rimorchio pieno a Tirano
            if (fullTrailers > 0 && hoursLeft >= HOURS_SHUTTLE_FROM_LIVIGNO) {
              fullTrailers--;
              emptyTrailers++;  // Rimorchio torna vuoto a Tirano
              // Motrice resta a Livigno (vehiclesAtLivigno non cambia)
              livignoDriverHours.set(driverId, hoursLeft - HOURS_SHUTTLE_FROM_LIVIGNO);
              totalShuttleFromLivigno++;
              litersToday += LITERS_PER_INTEGRATED_TANK;
              madeProgress = true;
              break;
            }
            // SUPPLY_FROM_LIVIGNO: se non ci sono rimorchi pieni, usa vuoti (10h, eccezione ADR)
            // NOTA: richiede eccezione ADR (max 2/settimana), quindi il driver deve avere
            // tutte le 9h disponibili (l'eccezione estende a 10h)
            const usedExceptions = livignoAdrExceptions.get(driverId) || 0;
            if (emptyTrailers > 0 && hoursLeft >= MAX_DAILY_HOURS && usedExceptions < MAX_ADR_EXTENDED_PER_WEEK) {
              emptyTrailers--;
              fullTrailers++;  // Rimorchio torna pieno a Tirano (disponibile per domani)
              // Motrice resta a Livigno
              livignoDriverHours.set(driverId, 0);  // Giornata finita (10h)
              livignoAdrExceptions.set(driverId, usedExceptions + 1);
              totalAdrExceptionsUsed++;
              totalSupplyFromLivigno++;
              litersToday += LITERS_PER_INTEGRATED_TANK;
              madeProgress = true;
              break;
            }
          }
        }

        if (madeProgress) continue;

        // Driver Livigno senza motrice a Livigno: SHUTTLE standard
        // (scende a Tirano, prende motrice piena, torna - motrice torna a Tirano)
        const livignoDriversForStandardShuttle = Array.from(livignoDriverHours.entries())
          .filter(([, h]) => h >= HOURS_SHUTTLE)
          .sort((a, b) => b[1] - a[1]);

        for (const [driverId, hoursLeft] of livignoDriversForStandardShuttle) {
          if (fullTanksAtTirano > 0 && hoursLeft >= HOURS_SHUTTLE) {
            fullTanksAtTirano--;
            emptyTanksAtTirano++;  // La motrice torna vuota a Tirano
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
          if (fullTanksAtTirano > 0 && hoursLeft >= HOURS_SHUTTLE) {
            fullTanksAtTirano--;
            emptyTanksAtTirano++;
            tiranoDriverHours.set(driverId, hoursLeft - HOURS_SHUTTLE);
            totalShuttle++;
            litersToday += LITERS_PER_INTEGRATED_TANK;
            madeProgress = true;
            break;
          }

          // PRIORITÀ 2: TRANSFER
          if (fullTrailers > 0 && emptyTanksAtTirano > 0 && hoursLeft >= HOURS_TRANSFER) {
            fullTrailers--;
            emptyTrailers++;
            emptyTanksAtTirano--;
            fullTanksAtTirano++;
            tiranoDriverHours.set(driverId, hoursLeft - HOURS_TRANSFER);
            totalTransfer++;
            madeProgress = true;
            break;
          }

          // PRIORITÀ 3: SUPPLY+SHUTTLE COMBO (10h con eccezione ADR)
          // Driver Tirano può fare SUPPLY (6h) + SHUTTLE (4h) = 10h con eccezione
          // Richiede: rimorchio vuoto, motrice, eccezione ADR disponibile
          const HOURS_SUPPLY_SHUTTLE_COMBO = HOURS_SUPPLY + HOURS_SHUTTLE; // 6h + 4h = 10h
          const tiranoUsedExceptions = tiranoAdrExceptions.get(driverId) || 0;
          if (emptyTrailers > 0 && emptyTanksAtTirano > 0 &&
              hoursLeft >= MAX_DAILY_HOURS && tiranoUsedExceptions < MAX_ADR_EXTENDED_PER_WEEK) {
            // SUPPLY: riempie motrice + rimorchio
            emptyTrailers--;
            emptyTanksAtTirano--;
            // Il rimorchio torna pieno a Tirano (disponibile per altri)
            fullTrailers++;
            // La motrice fa subito SHUTTLE e torna vuota
            emptyTanksAtTirano++;

            tiranoDriverHours.set(driverId, 0); // Giornata finita (10h con eccezione)
            tiranoAdrExceptions.set(driverId, tiranoUsedExceptions + 1);
            totalAdrExceptionsUsed++;

            // Conta come SUPPLY + SHUTTLE separati per il breakdown
            totalSupply++;
            totalShuttle++;
            litersToday += LITERS_PER_INTEGRATED_TANK; // 17.500L consegnati
            madeProgress = true;
            break;
          }

          // PRIORITÀ 4: FULL_ROUND (9.5h - difficile senza eccezione)
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
        shuttleFromLivigno: totalShuttleFromLivigno,
        supplyFromLivigno: totalSupplyFromLivigno,
        adrExceptionsUsed: totalAdrExceptionsUsed,
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
      shuttleFromLivigno: bestResult.breakdown.shuttleFromLivigno || 0,
      supplyFromLivigno: bestResult.breakdown.supplyFromLivigno || 0,
      adrExceptionsUsed: bestResult.breakdown.adrExceptionsUsed || 0,
    },
    dailyCapacity: bestResult.daysWithDeliveries > 0
      ? Math.floor(bestResult.totalLiters / bestResult.daysWithDeliveries)
      : 0,
    constraints: [],
  };
}
