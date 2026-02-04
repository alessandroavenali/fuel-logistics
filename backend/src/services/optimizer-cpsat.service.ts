/**
 * OR-Tools CP-SAT Optimizer Service
 *
 * Wrapper TypeScript che chiama il solver Python per l'ottimizzazione
 * del trasporto carburante Milano → Livigno.
 *
 * Il solver usa CP-SAT (Constraint Programming - Satisfiability) per:
 * - Modellazione time-indexed a slot da 15 min
 * - Vincoli no-overlap per driver
 * - Bilanci stock/flotta per slot
 * - Limiti ADR (guida giornaliera/settimanale/bisettimanale)
 * - Pausa 4h30→45' con finestra mobile
 * - Finestra ingresso Livigno (08:00–18:30)
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { PrismaClient, TripType, Driver, Vehicle, Trailer, Location } from '@prisma/client';
import type { DriverAvailabilityInput } from './optimizer.service.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SolverInput {
  start_date: string;  // ISO format: "2026-02-03"
  end_date: string;
  D_T: number[];       // Driver Tirano disponibili per giorno
  D_L: number[];       // Driver Livigno disponibili per giorno
  initial_state: {
    FT: number;        // Full Trailers (rimorchi pieni)
    ET: number;        // Empty Trailers (rimorchi vuoti)
    Tf: number;        // Tractors full (motrici piene)
    Te: number;        // Tractors empty (motrici vuote)
  };
  // Optional parameters (defaults in solver.py)
  liters_per_unit?: number;           // 17500
  total_trailers?: number;            // 4
  total_tractors?: number;            // 3
  drivers_T_base?: number;            // 4
  drivers_L_base?: number;            // 1
  max_resident_trips?: number;        // 2
  max_adr_trips?: number;             // 1
  adr_weekly_cap?: number;            // 2
  shift_minutes?: number;             // 720 (12h)
  slot_minutes?: number;              // 15
  drive_minutes_daily?: number;       // 540 (9h)
  drive_minutes_extended?: number;    // 600 (10h)
  max_extended_days_per_week?: number;// 2
  weekly_drive_limit_minutes?: number;// 3360 (56h)
  biweekly_drive_limit_minutes?: number; // 5400 (90h)
  livigno_entry_start_minutes?: number;  // 120 (08:00)
  livigno_entry_end_minutes?: number;    // 750 (18:30)
  time_limit_seconds?: number;        // 60
  num_search_workers?: number;        // 8
}

export interface DayResult {
  date: string;
  D_T: number;
  D_L: number;
  S: number;   // Supply trips
  U: number;   // Shuttle trips (Tirano)
  V: number;   // Resident trips (Livigno)
  A: number;   // ADR trips (Livigno)
  R: number;   // Refill operations
  drivers_T: { starts: { task: string; slot: number }[] }[];
  drivers_L: { starts: { task: string; slot: number }[] }[];
  FT_start: number;
  ET_start: number;
  Tf_start: number;
  Te_start: number;
  FT_end: number;
  ET_end: number;
  Tf_end: number;
  Te_end: number;
  turns?: {
    tirano: { drivers: number; turns: { minutes: number; tasks: number[] }[] };
    livigno: { drivers: number; turns: { minutes: number; tasks: number[] }[] };
  };
}

export interface SolverOutput {
  status: 'OPTIMAL' | 'FEASIBLE' | 'INFEASIBLE' | 'MODEL_INVALID' | 'UNKNOWN';
  objective_deliveries: number;
  objective_liters: number;
  days: DayResult[];
}

// ============================================================================
// SOLVER
// ============================================================================

const SOLVER_DIR = path.join(__dirname, '..', 'solver');

/**
 * Esegue il solver CP-SAT Python e ritorna il risultato.
 */
export async function runCPSATSolver(input: SolverInput): Promise<SolverOutput> {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', ['main.py'], {
      cwd: SOLVER_DIR,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Solver failed with code ${code}: ${stderr}`));
        return;
      }

      try {
        const result = JSON.parse(stdout) as SolverOutput;
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse solver output: ${e}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn solver: ${err.message}`));
    });

    // Write input to stdin
    pythonProcess.stdin.write(JSON.stringify(input));
    pythonProcess.stdin.end();
  });
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Crea l'input per il solver a partire dai parametri standard.
 */
export function createSolverInput(params: {
  startDate: Date;
  endDate: Date;
  tiranoDriversPerDay: number[];
  livignoDriversPerDay: number[];
  numTrailers: number;
  numTractors: number;
  initialFullTrailers?: number;
  initialFullTractors?: number;
  timeLimitSeconds?: number;
}): SolverInput {
  const {
    startDate,
    endDate,
    tiranoDriversPerDay,
    livignoDriversPerDay,
    numTrailers,
    numTractors,
    initialFullTrailers = 0,
    initialFullTractors = 0,
    timeLimitSeconds = 60,
  } = params;

  return {
    start_date: startDate.toISOString().split('T')[0],
    end_date: endDate.toISOString().split('T')[0],
    D_T: tiranoDriversPerDay,
    D_L: livignoDriversPerDay,
    initial_state: {
      FT: initialFullTrailers,
      ET: numTrailers - initialFullTrailers,
      Tf: initialFullTractors,
      Te: numTractors - initialFullTractors,
    },
    total_trailers: numTrailers,
    total_tractors: numTractors,
    drivers_T_base: Math.max(...tiranoDriversPerDay, 4),
    drivers_L_base: Math.max(...livignoDriversPerDay, 1),
    time_limit_seconds: timeLimitSeconds,
  };
}

/**
 * Formatta il risultato del solver in formato leggibile.
 */
export function formatSolverResult(result: SolverOutput): string {
  const lines: string[] = [];

  lines.push('═'.repeat(70));
  lines.push(`RISULTATO SOLVER CP-SAT: ${result.status}`);
  lines.push('═'.repeat(70));
  lines.push(`Totale consegne: ${result.objective_deliveries}`);
  lines.push(`Totale litri: ${result.objective_liters.toLocaleString()}L`);
  lines.push('');

  for (const day of result.days) {
    const deliveries = day.U + day.V + day.A;
    const liters = deliveries * 17500;

    lines.push(`${day.date}: ${liters.toLocaleString()}L (${deliveries} consegne)`);
    lines.push(`  SUPPLY=${day.S}, SHUTTLE=${day.U}, RESIDENT=${day.V}, ADR=${day.A}, REFILL=${day.R}`);
    lines.push(`  Stato inizio: FT=${day.FT_start}, ET=${day.ET_start}, Tf=${day.Tf_start}, Te=${day.Te_start}`);
    lines.push(`  Stato fine:   FT=${day.FT_end}, ET=${day.ET_end}, Tf=${day.Tf_end}, Te=${day.Te_end}`);
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Converte slot (15 min) in orario HH:MM (partendo da 06:00).
 */
export function slotToTime(slot: number, startHour: number = 6): string {
  const minutes = slot * 15;
  const totalMinutes = startHour * 60 + minutes;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

// ============================================================================
// LEGACY COMPATIBILITY
// ============================================================================

/**
 * Interfaccia compatibile con il vecchio optimizer per transizione graduale.
 */
export interface LegacyGlobalResult {
  totalLiters: number;
  dayPlans: {
    date: string;
    supplyTrips: number;
    transferTrips: number;
    shuttleTrips: number;
    fullRoundTrips: number;
    livignoShuttles: number;
    livignoSupplyTrips: number;
    litersDelivered: number;
    endState: {
      fullTrailers: number;
      emptyTrailers: number;
      fullTanks: number;
    };
  }[];
  breakdown: {
    supplyTrips: number;
    transferTrips: number;
    shuttleTrips: number;
    fullRoundTrips: number;
    livignoShuttles: number;
    livignoSupplyTrips: number;
  };
  daysWithDeliveries: number;
}

/**
 * Wrapper per compatibilità con l'API esistente.
 *
 * Nota: Il solver CP-SAT non distingue tra SHUTTLE e FULL_ROUND,
 * e usa nomenclatura diversa (V=RESIDENT, A=ADR invece di SHUTTLE_FROM_LIVIGNO).
 */
export async function calculateGlobalMaxCPSAT(
  numDays: number,
  tiranoDriversPerDay: { id: string; maxHours: number }[][],
  numTrailers: number,
  numVehicles: number,
  initialFullTrailers: number = 0,
  initialFullTanks: number = 0,
  livignoDriversPerDay: { id: string; maxHours: number }[][] = [],
  timeLimitSeconds: number = 60
): Promise<LegacyGlobalResult> {
  // Calcola date (da oggi)
  const startDate = new Date();
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + numDays - 1);

  // Estrai conteggio driver per giorno
  const tiranoDriverCounts = tiranoDriversPerDay.map(d => d.length);
  const livignoDriverCounts = livignoDriversPerDay.map(d => d.length);

  const input = createSolverInput({
    startDate,
    endDate,
    tiranoDriversPerDay: tiranoDriverCounts,
    livignoDriversPerDay: livignoDriverCounts,
    numTrailers,
    numTractors: numVehicles,
    initialFullTrailers,
    initialFullTractors: initialFullTanks,
    timeLimitSeconds,
  });

  const result = await runCPSATSolver(input);

  // Converti in formato legacy
  const dayPlans = result.days.map(day => ({
    date: day.date,
    supplyTrips: day.S,
    transferTrips: day.R,  // Refill ≈ Transfer
    shuttleTrips: day.U,
    fullRoundTrips: 0,     // CP-SAT non usa FULL_ROUND
    livignoShuttles: day.V,
    livignoSupplyTrips: day.A,
    litersDelivered: (day.U + day.V + day.A) * 17500,
    endState: {
      fullTrailers: day.FT_end,
      emptyTrailers: day.ET_end,
      fullTanks: day.Tf_end,
    },
  }));

  const totals = dayPlans.reduce(
    (acc, day) => ({
      supplyTrips: acc.supplyTrips + day.supplyTrips,
      transferTrips: acc.transferTrips + day.transferTrips,
      shuttleTrips: acc.shuttleTrips + day.shuttleTrips,
      fullRoundTrips: acc.fullRoundTrips + day.fullRoundTrips,
      livignoShuttles: acc.livignoShuttles + day.livignoShuttles,
      livignoSupplyTrips: acc.livignoSupplyTrips + day.livignoSupplyTrips,
    }),
    {
      supplyTrips: 0,
      transferTrips: 0,
      shuttleTrips: 0,
      fullRoundTrips: 0,
      livignoShuttles: 0,
      livignoSupplyTrips: 0,
    }
  );

  return {
    totalLiters: result.objective_liters,
    dayPlans,
    breakdown: totals,
    daysWithDeliveries: dayPlans.filter(d => d.litersDelivered > 0).length,
  };
}

// ============================================================================
// CP-SAT TO TRIP CONVERSION
// ============================================================================

// Task durations in slots (15 min each) and minutes
const TASK_DURATIONS = {
  S: { slots: 23, minutes: 345 },  // SUPPLY_MILANO
  U: { slots: 16, minutes: 240 },  // SHUTTLE_LIVIGNO
  V: { slots: 18, minutes: 270 },  // SHUTTLE_FROM_LIVIGNO
  A: { slots: 39, minutes: 585 },  // SUPPLY_FROM_LIVIGNO
  R: { slots: 2, minutes: 30 },    // TRANSFER_TIRANO
} as const;

// Map CP-SAT tasks to TripType
const TASK_TO_TRIP_TYPE: Record<string, TripType> = {
  S: 'SUPPLY_MILANO',
  U: 'SHUTTLE_LIVIGNO',
  V: 'SHUTTLE_FROM_LIVIGNO',
  A: 'SUPPLY_FROM_LIVIGNO',
  R: 'TRANSFER_TIRANO',
};

// Liters delivered per trip type (only delivery trips)
const TRIP_LITERS: Record<TripType, number> = {
  SHUTTLE_LIVIGNO: 17500,
  SUPPLY_MILANO: 0,             // Only fills Tirano, no delivery
  FULL_ROUND: 17500,
  TRANSFER_TIRANO: 0,           // Transfer only, no delivery
  SHUTTLE_FROM_LIVIGNO: 17500,
  SUPPLY_FROM_LIVIGNO: 17500,
};

const LITERS_PER_UNIT = 17500;
const DEFAULT_START_HOUR = 6;

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

interface ConversionContext {
  prisma: PrismaClient;
  scheduleId: string;
  tiranoDrivers: Driver[];
  livignoDrivers: Driver[];
  tiranoVehicles: Vehicle[];
  livignoVehicles: Vehicle[];
  trailers: Trailer[];
  locations: {
    tirano: Location;
    livigno: Location;
    milano: Location;
  };
  startDate: Date;
}

interface ResourceTracker {
  // Vehicle availability: vehicleId -> list of busy time slots
  vehicleSlots: Map<string, { start: Date; end: Date }[]>;
  // Trailer availability: trailerId -> list of busy time slots
  trailerSlots: Map<string, { start: Date; end: Date }[]>;
  // Trailer state at Tirano
  trailerState: {
    atTiranoFull: Set<string>;
    atTiranoEmpty: Set<string>;
  };
  // Vehicle tank state
  vehicleTankState: {
    tankFull: Map<string, boolean>;
    location: Map<string, string>;
  };
  // Pending resources (will be available at specific time)
  pendingFullTrailers: Map<string, Date>;  // trailerId -> available at
  pendingEmptyTrailers: Map<string, Date>; // trailerId -> available at
  pendingFullTanks: Map<string, Date>;     // vehicleId -> available at
}

/**
 * Check if a resource is available during a time slot.
 */
function isResourceAvailable(
  resourceId: string,
  start: Date,
  end: Date,
  slots: Map<string, { start: Date; end: Date }[]>
): boolean {
  const busySlots = slots.get(resourceId) || [];
  return !busySlots.some(slot =>
    start < slot.end && slot.start < end
  );
}

/**
 * Reserve a resource for a time slot.
 */
function reserveResource(
  resourceId: string,
  start: Date,
  end: Date,
  slots: Map<string, { start: Date; end: Date }[]>
): void {
  if (!slots.has(resourceId)) {
    slots.set(resourceId, []);
  }
  slots.get(resourceId)!.push({ start, end });
}

/**
 * Find an available resource from a list.
 */
function findAvailableResource<T extends { id: string }>(
  resources: T[],
  start: Date,
  end: Date,
  slots: Map<string, { start: Date; end: Date }[]>
): T | null {
  for (const resource of resources) {
    if (isResourceAvailable(resource.id, start, end, slots)) {
      return resource;
    }
  }
  return null;
}

/**
 * Convert slot number to Date object.
 * Slot 0 = 06:00 on the given date, each slot = 15 minutes.
 */
function slotToDate(slot: number, dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setHours(DEFAULT_START_HOUR, 0, 0, 0);
  date.setMinutes(date.getMinutes() + slot * 15);
  return date;
}

/**
 * Convert solver output to concrete Trip objects.
 *
 * Maps abstract task assignments (driver index + slot) to real driver/vehicle/trailer IDs
 * and calculates departure/return times.
 */
export async function convertSolverOutputToTrips(
  result: SolverOutput,
  ctx: ConversionContext
): Promise<GeneratedTrip[]> {
  const trips: GeneratedTrip[] = [];
  const tracker: ResourceTracker = {
    vehicleSlots: new Map(),
    trailerSlots: new Map(),
    trailerState: {
      atTiranoFull: new Set(),
      atTiranoEmpty: new Set(),
    },
    vehicleTankState: {
      tankFull: new Map(),
      location: new Map(),
    },
    pendingFullTrailers: new Map(),
    pendingEmptyTrailers: new Map(),
    pendingFullTanks: new Map(),
  };

  // Initialize trailer state from schedule initial states
  const initialStates = await ctx.prisma.scheduleInitialState.findMany({
    where: { scheduleId: ctx.scheduleId },
    include: { location: true },
  });

  for (const trailer of ctx.trailers) {
    const initialState = initialStates.find(s => s.trailerId === trailer.id);
    if (initialState) {
      if (initialState.location.type === 'SOURCE') {
        // At Milano - not available at Tirano
      } else if (initialState.isFull) {
        tracker.trailerState.atTiranoFull.add(trailer.id);
      } else {
        tracker.trailerState.atTiranoEmpty.add(trailer.id);
      }
    } else {
      // Default: all trailers start empty at Tirano
      tracker.trailerState.atTiranoEmpty.add(trailer.id);
    }
  }

  // Initialize vehicle state from schedule vehicle states
  const vehicleStates = await ctx.prisma.scheduleVehicleState.findMany({
    where: { scheduleId: ctx.scheduleId },
    include: { location: true },
  });

  const allVehicles = [...ctx.tiranoVehicles, ...ctx.livignoVehicles];
  for (const vehicle of allVehicles) {
    const vehicleState = vehicleStates.find(s => s.vehicleId === vehicle.id);
    if (vehicleState) {
      tracker.vehicleTankState.tankFull.set(vehicle.id, vehicleState.isTankFull);
      tracker.vehicleTankState.location.set(vehicle.id, vehicleState.locationId);
    } else {
      // Default: empty tank at base location
      tracker.vehicleTankState.tankFull.set(vehicle.id, false);
      tracker.vehicleTankState.location.set(vehicle.id, vehicle.baseLocationId || ctx.locations.tirano.id);
    }
  }

  // Process each day
  for (const dayResult of result.days) {
    const dateStr = dayResult.date;

    // Update pending resources that are now available
    const dayStart = slotToDate(0, dateStr);
    for (const [trailerId, availAt] of tracker.pendingFullTrailers) {
      if (availAt <= dayStart) {
        tracker.trailerState.atTiranoFull.add(trailerId);
        tracker.pendingFullTrailers.delete(trailerId);
      }
    }
    for (const [trailerId, availAt] of tracker.pendingEmptyTrailers) {
      if (availAt <= dayStart) {
        tracker.trailerState.atTiranoEmpty.add(trailerId);
        tracker.pendingEmptyTrailers.delete(trailerId);
      }
    }

    // Collect all tasks for this day with their assignments
    interface TaskAssignment {
      driverIndex: number;
      driverBase: 'tirano' | 'livigno';
      task: string;
      slot: number;
    }

    const assignments: TaskAssignment[] = [];

    // Tirano drivers
    for (let i = 0; i < dayResult.drivers_T.length; i++) {
      for (const start of dayResult.drivers_T[i].starts) {
        assignments.push({
          driverIndex: i,
          driverBase: 'tirano',
          task: start.task,
          slot: start.slot,
        });
      }
    }

    // Livigno drivers
    for (let j = 0; j < dayResult.drivers_L.length; j++) {
      for (const start of dayResult.drivers_L[j].starts) {
        assignments.push({
          driverIndex: j,
          driverBase: 'livigno',
          task: start.task,
          slot: start.slot,
        });
      }
    }

    // Sort by slot to process in chronological order
    assignments.sort((a, b) => a.slot - b.slot);

    // Track driver usage for this day
    const driverUsage = new Map<string, number>(); // driverId -> last return slot

    // Process each assignment
    for (const assignment of assignments) {
      const { driverIndex, driverBase, task, slot } = assignment;
      const taskDuration = TASK_DURATIONS[task as keyof typeof TASK_DURATIONS];
      if (!taskDuration) continue;

      const tripType = TASK_TO_TRIP_TYPE[task];
      if (!tripType) continue;

      const departureTime = slotToDate(slot, dateStr);
      const returnTime = new Date(departureTime);
      returnTime.setMinutes(returnTime.getMinutes() + taskDuration.minutes);

      // Get driver from appropriate pool
      const driverPool = driverBase === 'tirano' ? ctx.tiranoDrivers : ctx.livignoDrivers;
      if (driverIndex >= driverPool.length) {
        console.warn(`Driver index ${driverIndex} out of range for ${driverBase} pool`);
        continue;
      }
      const driver = driverPool[driverIndex];

      // Find available vehicle based on task type
      let vehicle: Vehicle | null = null;
      let tripTrailers: GeneratedTrip['trailers'] = [];

      switch (task) {
        case 'S': // SUPPLY_MILANO - Tirano driver, vehicle at Tirano
          vehicle = findVehicleAtLocation(
            ctx.tiranoVehicles,
            ctx.locations.tirano.id,
            false, // empty tank OK
            departureTime,
            returnTime,
            tracker
          );
          if (vehicle) {
            // Find empty trailer for supply
            const trailerId = findTrailerForSupply(tracker, departureTime, returnTime);
            if (trailerId) {
              tripTrailers = [{
                trailerId,
                litersLoaded: LITERS_PER_UNIT,
                dropOffLocationId: ctx.locations.tirano.id,
                isPickup: false,
              }];
              // Update state: trailer becomes full at return time
              tracker.trailerState.atTiranoEmpty.delete(trailerId);
              tracker.pendingFullTrailers.set(trailerId, returnTime);
              reserveResource(trailerId, departureTime, returnTime, tracker.trailerSlots);
              // Vehicle tank also becomes full
              tracker.pendingFullTanks.set(vehicle.id, returnTime);
            }
            reserveResource(vehicle.id, departureTime, returnTime, tracker.vehicleSlots);
          }
          break;

        case 'U': // SHUTTLE_LIVIGNO - Tirano driver, vehicle with full tank at Tirano
          vehicle = findVehicleAtLocation(
            ctx.tiranoVehicles,
            ctx.locations.tirano.id,
            true, // needs full tank
            departureTime,
            returnTime,
            tracker
          );
          if (vehicle) {
            reserveResource(vehicle.id, departureTime, returnTime, tracker.vehicleSlots);
            // Tank becomes empty after delivery
            tracker.vehicleTankState.tankFull.set(vehicle.id, false);
          }
          break;

        case 'V': // SHUTTLE_FROM_LIVIGNO - Livigno driver, vehicle at Livigno
          vehicle = findVehicleAtLocation(
            ctx.livignoVehicles,
            ctx.locations.livigno.id,
            false, // starts with empty tank
            departureTime,
            returnTime,
            tracker
          );
          if (vehicle) {
            // This trip consumes a full trailer at Tirano (implicit TRANSFER)
            const trailerId = findFullTrailer(tracker, departureTime, returnTime);
            if (trailerId) {
              tripTrailers = [{
                trailerId,
                litersLoaded: LITERS_PER_UNIT,
                dropOffLocationId: ctx.locations.tirano.id,
                isPickup: true, // Transfer from trailer to tank
              }];
              // Trailer becomes empty
              tracker.trailerState.atTiranoFull.delete(trailerId);
              tracker.pendingEmptyTrailers.set(trailerId, returnTime);
              reserveResource(trailerId, departureTime, returnTime, tracker.trailerSlots);
            }
            reserveResource(vehicle.id, departureTime, returnTime, tracker.vehicleSlots);
          }
          break;

        case 'A': // SUPPLY_FROM_LIVIGNO - Livigno driver, ADR extended trip
          vehicle = findVehicleAtLocation(
            ctx.livignoVehicles,
            ctx.locations.livigno.id,
            false,
            departureTime,
            returnTime,
            tracker
          );
          if (vehicle) {
            // Uses empty trailer at Tirano, leaves it full
            const trailerId = findTrailerForSupply(tracker, departureTime, returnTime);
            if (trailerId) {
              tripTrailers = [{
                trailerId,
                litersLoaded: LITERS_PER_UNIT,
                dropOffLocationId: ctx.locations.tirano.id,
                isPickup: false,
              }];
              tracker.trailerState.atTiranoEmpty.delete(trailerId);
              tracker.pendingFullTrailers.set(trailerId, returnTime);
              reserveResource(trailerId, departureTime, returnTime, tracker.trailerSlots);
            }
            reserveResource(vehicle.id, departureTime, returnTime, tracker.vehicleSlots);
          }
          break;

        case 'R': // TRANSFER_TIRANO - Refill operation, done by Tirano driver
          vehicle = findVehicleAtLocation(
            ctx.tiranoVehicles,
            ctx.locations.tirano.id,
            false, // empty tank (will be filled)
            departureTime,
            returnTime,
            tracker
          );
          if (vehicle) {
            const trailerId = findFullTrailer(tracker, departureTime, returnTime);
            if (trailerId) {
              tripTrailers = [{
                trailerId,
                litersLoaded: LITERS_PER_UNIT,
                dropOffLocationId: ctx.locations.tirano.id,
                isPickup: true,
              }];
              tracker.trailerState.atTiranoFull.delete(trailerId);
              tracker.pendingEmptyTrailers.set(trailerId, returnTime);
              // Vehicle tank becomes full
              tracker.vehicleTankState.tankFull.set(vehicle.id, true);
              reserveResource(trailerId, departureTime, returnTime, tracker.trailerSlots);
            }
            reserveResource(vehicle.id, departureTime, returnTime, tracker.vehicleSlots);
          }
          break;
      }

      if (!vehicle) {
        console.warn(`No vehicle available for ${task} at slot ${slot} on ${dateStr}`);
        continue;
      }

      trips.push({
        date: departureTime,
        departureTime,
        returnTime,
        vehicleId: vehicle.id,
        driverId: driver.id,
        tripType,
        trailers: tripTrailers,
      });
    }
  }

  return trips;
}

/**
 * Find a vehicle at a specific location with specified tank state.
 */
function findVehicleAtLocation(
  vehicles: Vehicle[],
  locationId: string,
  needsFullTank: boolean,
  start: Date,
  end: Date,
  tracker: ResourceTracker
): Vehicle | null {
  for (const vehicle of vehicles) {
    const location = tracker.vehicleTankState.location.get(vehicle.id);
    const isFull = tracker.vehicleTankState.tankFull.get(vehicle.id) ?? false;

    // Check pending full tanks
    let willBeFull = isFull;
    const pendingTime = tracker.pendingFullTanks.get(vehicle.id);
    if (pendingTime && pendingTime <= start) {
      willBeFull = true;
      tracker.vehicleTankState.tankFull.set(vehicle.id, true);
      tracker.pendingFullTanks.delete(vehicle.id);
    }

    if (location === locationId &&
        (!needsFullTank || willBeFull) &&
        isResourceAvailable(vehicle.id, start, end, tracker.vehicleSlots)) {
      return vehicle;
    }
  }
  return null;
}

/**
 * Find an empty trailer at Tirano for SUPPLY.
 */
function findTrailerForSupply(
  tracker: ResourceTracker,
  start: Date,
  end: Date
): string | null {
  for (const trailerId of tracker.trailerState.atTiranoEmpty) {
    if (isResourceAvailable(trailerId, start, end, tracker.trailerSlots)) {
      return trailerId;
    }
  }
  // Check pending empty trailers
  for (const [trailerId, availAt] of tracker.pendingEmptyTrailers) {
    if (availAt <= start && isResourceAvailable(trailerId, start, end, tracker.trailerSlots)) {
      tracker.trailerState.atTiranoEmpty.add(trailerId);
      tracker.pendingEmptyTrailers.delete(trailerId);
      return trailerId;
    }
  }
  return null;
}

/**
 * Find a full trailer at Tirano for TRANSFER/SHUTTLE_FROM_LIVIGNO.
 */
function findFullTrailer(
  tracker: ResourceTracker,
  start: Date,
  end: Date
): string | null {
  for (const trailerId of tracker.trailerState.atTiranoFull) {
    if (isResourceAvailable(trailerId, start, end, tracker.trailerSlots)) {
      return trailerId;
    }
  }
  // Check pending full trailers
  for (const [trailerId, availAt] of tracker.pendingFullTrailers) {
    if (availAt <= start && isResourceAvailable(trailerId, start, end, tracker.trailerSlots)) {
      tracker.trailerState.atTiranoFull.add(trailerId);
      tracker.pendingFullTrailers.delete(trailerId);
      return trailerId;
    }
  }
  return null;
}

// ============================================================================
// OPTIMIZATION RESULT INTERFACE
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
      SHUTTLE_FROM_LIVIGNO: number;
      SUPPLY_FROM_LIVIGNO: number;
    };
  };
  solverStatus?: string;
  solverObjectiveLiters?: number;
}

/**
 * Get working days between two dates.
 */
function getWorkingDays(startDate: Date, endDate: Date, includeWeekend: boolean = false): Date[] {
  const days: Date[] = [];
  const current = new Date(startDate);

  while (current <= endDate) {
    const dayOfWeek = current.getDay();
    if (includeWeekend || (dayOfWeek >= 1 && dayOfWeek <= 5)) {
      days.push(new Date(current));
    }
    current.setDate(current.getDate() + 1);
  }

  return days;
}

/**
 * Main entry point for CP-SAT optimization.
 *
 * Takes a schedule ID and driver availability, builds solver input from DB state,
 * runs the solver, and converts the output to concrete Trip objects.
 */
export async function runCPSATOptimizer(
  prisma: PrismaClient,
  scheduleId: string,
  driverAvailability?: DriverAvailabilityInput[]
): Promise<OptimizationResult> {
  const warnings: string[] = [];

  // Fetch schedule
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      initialStates: { include: { location: true } },
      vehicleStates: { include: { location: true } },
    },
  });

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  // Fetch resources
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

  // Find key locations
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const milanoLocation = locations.find(l => l.type === 'SOURCE');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');

  if (!tiranoLocation || !milanoLocation || !livignoLocation) {
    throw new Error('Missing required locations (Milano, Tirano, Livigno)');
  }

  // Separate drivers and vehicles by base
  const tiranoDrivers = drivers.filter(d => d.baseLocationId !== livignoLocation.id);
  const livignoDrivers = drivers.filter(d => d.baseLocationId === livignoLocation.id);
  const tiranoVehicles = vehicles.filter(v => v.baseLocationId !== livignoLocation.id);
  const livignoVehicles = vehicles.filter(v => v.baseLocationId === livignoLocation.id);

  // Get working days
  const workingDays = getWorkingDays(schedule.startDate, schedule.endDate, schedule.includeWeekend);
  const allDates = workingDays.map(d => d.toISOString().split('T')[0]);

  // Build driver counts per day
  const tiranoDriversPerDay: number[] = [];
  const livignoDriversPerDay: number[] = [];

  for (const day of workingDays) {
    const dateKey = day.toISOString().split('T')[0];

    let tiranoCount = 0;
    let livignoCount = 0;

    if (driverAvailability && driverAvailability.length > 0) {
      // Use explicit availability
      for (const avail of driverAvailability) {
        if (avail.availableDates.includes(dateKey)) {
          const driver = drivers.find(d => d.id === avail.driverId);
          if (driver) {
            if (driver.baseLocationId === livignoLocation.id) {
              livignoCount++;
            } else {
              tiranoCount++;
            }
          }
        }
      }
    } else {
      // Default: only RESIDENT drivers
      tiranoCount = tiranoDrivers.filter(d => d.type === 'RESIDENT').length;
      livignoCount = livignoDrivers.filter(d => d.type === 'RESIDENT').length;
    }

    tiranoDriversPerDay.push(tiranoCount);
    livignoDriversPerDay.push(livignoCount);
  }

  // Calculate initial state
  let initialFullTrailers = 0;
  let initialFullTractors = 0;

  for (const state of schedule.initialStates) {
    if (state.isFull && state.location.type === 'PARKING') {
      initialFullTrailers++;
    }
  }

  for (const state of schedule.vehicleStates) {
    if (state.isTankFull && state.location.type === 'PARKING') {
      initialFullTractors++;
    }
  }

  // Build solver input
  const solverInput = createSolverInput({
    startDate: schedule.startDate,
    endDate: schedule.endDate,
    tiranoDriversPerDay,
    livignoDriversPerDay,
    numTrailers: trailers.length,
    numTractors: tiranoVehicles.length,
    initialFullTrailers,
    initialFullTractors,
    timeLimitSeconds: 60,
  });

  // Run solver
  let solverResult: SolverOutput;
  try {
    solverResult = await runCPSATSolver(solverInput);
  } catch (error) {
    warnings.push(`Solver error: ${error}`);
    return {
      success: false,
      trips: [],
      warnings,
      statistics: {
        totalTrips: 0,
        totalLiters: 0,
        totalDrivingHours: 0,
        trailersAtParking: trailers.length,
        unmetLiters: schedule.requiredLiters,
        tripsByType: {
          SHUTTLE_LIVIGNO: 0,
          SUPPLY_MILANO: 0,
          FULL_ROUND: 0,
          TRANSFER_TIRANO: 0,
          SHUTTLE_FROM_LIVIGNO: 0,
          SUPPLY_FROM_LIVIGNO: 0,
        },
      },
    };
  }

  if (solverResult.status === 'INFEASIBLE' || solverResult.status === 'MODEL_INVALID') {
    warnings.push(`Solver returned ${solverResult.status}`);
    return {
      success: false,
      trips: [],
      warnings,
      statistics: {
        totalTrips: 0,
        totalLiters: 0,
        totalDrivingHours: 0,
        trailersAtParking: trailers.length,
        unmetLiters: schedule.requiredLiters,
        tripsByType: {
          SHUTTLE_LIVIGNO: 0,
          SUPPLY_MILANO: 0,
          FULL_ROUND: 0,
          TRANSFER_TIRANO: 0,
          SHUTTLE_FROM_LIVIGNO: 0,
          SUPPLY_FROM_LIVIGNO: 0,
        },
      },
      solverStatus: solverResult.status,
    };
  }

  // Convert solver output to trips
  const conversionContext: ConversionContext = {
    prisma,
    scheduleId,
    tiranoDrivers,
    livignoDrivers,
    tiranoVehicles,
    livignoVehicles,
    trailers,
    locations: {
      tirano: tiranoLocation,
      livigno: livignoLocation,
      milano: milanoLocation,
    },
    startDate: schedule.startDate,
  };

  const trips = await convertSolverOutputToTrips(solverResult, conversionContext);

  // Calculate statistics
  const tripsByType = {
    SHUTTLE_LIVIGNO: 0,
    SUPPLY_MILANO: 0,
    FULL_ROUND: 0,
    TRANSFER_TIRANO: 0,
    SHUTTLE_FROM_LIVIGNO: 0,
    SUPPLY_FROM_LIVIGNO: 0,
  };

  let totalLiters = 0;
  let totalDrivingHours = 0;

  for (const trip of trips) {
    tripsByType[trip.tripType]++;
    totalLiters += TRIP_LITERS[trip.tripType];
    totalDrivingHours += (trip.returnTime.getTime() - trip.departureTime.getTime()) / (1000 * 60 * 60);
  }

  // Delete existing trips and create new ones
  await prisma.$transaction(async (tx) => {
    await tx.trip.deleteMany({ where: { scheduleId } });

    for (const trip of trips) {
      await tx.trip.create({
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
            create: trip.trailers.map(t => ({
              trailerId: t.trailerId,
              litersLoaded: t.litersLoaded,
              dropOffLocationId: t.dropOffLocationId,
              isPickup: t.isPickup,
            })),
          },
        },
      });
    }
  });

  return {
    success: totalLiters >= schedule.requiredLiters,
    trips,
    warnings,
    statistics: {
      totalTrips: trips.length,
      totalLiters,
      totalDrivingHours,
      trailersAtParking: trailers.length,
      unmetLiters: Math.max(0, schedule.requiredLiters - totalLiters),
      tripsByType,
    },
    solverStatus: solverResult.status,
    solverObjectiveLiters: solverResult.objective_liters,
  };
}

// ============================================================================
// CALCULATE MAX CAPACITY WITH CP-SAT
// ============================================================================

export interface MaxCapacityResult {
  maxLiters: number;
  workingDays: number;
  daysWithDeliveries: number;
  breakdown: {
    livignoDriverShuttles: number;
    livignoSupplyTrips: number;
    tiranoDriverShuttles: number;
    tiranoDriverFullRounds: number;
    supplyTrips: number;
    transferTrips: number;
    shuttleFromLivigno: number;
    supplyFromLivigno: number;
    adrExceptionsUsed: number;
  };
  dailyCapacity: number;
  constraints: string[];
  solverStatus?: string;
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

/**
 * Calculate maximum capacity using CP-SAT solver.
 */
export async function calculateMaxCapacityCPSAT(
  prisma: PrismaClient,
  input: CalculateMaxInput
): Promise<MaxCapacityResult> {
  const startDate = new Date(input.startDate);
  const endDate = new Date(input.endDate);
  const workingDays = getWorkingDays(startDate, endDate, input.includeWeekend ?? false);
  const constraints: string[] = [];

  // Fetch resources
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
    throw new Error('Missing required locations');
  }

  const tiranoDrivers = drivers.filter(d => d.baseLocationId !== livignoLocation.id);
  const livignoDrivers = drivers.filter(d => d.baseLocationId === livignoLocation.id);
  const tiranoVehicles = vehicles.filter(v => v.baseLocationId !== livignoLocation.id);

  // Build driver counts per day
  const tiranoDriversPerDay: number[] = [];
  const livignoDriversPerDay: number[] = [];

  for (const day of workingDays) {
    const dateKey = day.toISOString().split('T')[0];

    let tiranoCount = 0;
    let livignoCount = 0;

    if (input.driverAvailability && input.driverAvailability.length > 0) {
      for (const avail of input.driverAvailability) {
        if (avail.availableDates.includes(dateKey)) {
          const driver = drivers.find(d => d.id === avail.driverId);
          if (driver) {
            if (driver.baseLocationId === livignoLocation.id) {
              livignoCount++;
            } else {
              tiranoCount++;
            }
          }
        }
      }
    } else {
      tiranoCount = tiranoDrivers.filter(d => d.type === 'RESIDENT').length;
      livignoCount = livignoDrivers.filter(d => d.type === 'RESIDENT').length;
    }

    tiranoDriversPerDay.push(tiranoCount);
    livignoDriversPerDay.push(livignoCount);
  }

  // Calculate initial state
  let initialFullTrailers = 0;
  let initialFullTractors = 0;

  if (input.initialStates) {
    for (const state of input.initialStates) {
      if (state.isFull && state.locationId === tiranoLocation.id) {
        initialFullTrailers++;
      }
    }
  }

  if (input.vehicleStates) {
    for (const state of input.vehicleStates) {
      if (state.isTankFull && state.locationId === tiranoLocation.id) {
        initialFullTractors++;
      }
    }
  }

  // Build and run solver
  const solverInput = createSolverInput({
    startDate,
    endDate,
    tiranoDriversPerDay,
    livignoDriversPerDay,
    numTrailers: trailers.length,
    numTractors: tiranoVehicles.length,
    initialFullTrailers,
    initialFullTractors,
    timeLimitSeconds: 60,
  });

  let solverResult: SolverOutput;
  try {
    solverResult = await runCPSATSolver(solverInput);
  } catch (error) {
    constraints.push(`Solver error: ${error}`);
    return {
      maxLiters: 0,
      workingDays: workingDays.length,
      daysWithDeliveries: 0,
      breakdown: {
        livignoDriverShuttles: 0,
        livignoSupplyTrips: 0,
        tiranoDriverShuttles: 0,
        tiranoDriverFullRounds: 0,
        supplyTrips: 0,
        transferTrips: 0,
        shuttleFromLivigno: 0,
        supplyFromLivigno: 0,
        adrExceptionsUsed: 0,
      },
      dailyCapacity: 0,
      constraints,
    };
  }

  // Aggregate results
  let totalSupply = 0;
  let totalTransfer = 0;
  let totalShuttle = 0;
  let totalResident = 0;
  let totalAdr = 0;
  let daysWithDeliveries = 0;

  for (const day of solverResult.days) {
    totalSupply += day.S;
    totalTransfer += day.R;
    totalShuttle += day.U;
    totalResident += day.V;
    totalAdr += day.A;
    if (day.U + day.V + day.A > 0) {
      daysWithDeliveries++;
    }
  }

  const maxLiters = solverResult.objective_liters;
  const dailyCapacity = daysWithDeliveries > 0 ? Math.round(maxLiters / daysWithDeliveries) : 0;

  return {
    maxLiters,
    workingDays: workingDays.length,
    daysWithDeliveries,
    breakdown: {
      livignoDriverShuttles: 0,          // Legacy field, not used by CP-SAT
      livignoSupplyTrips: 0,             // Legacy field
      tiranoDriverShuttles: totalShuttle,
      tiranoDriverFullRounds: 0,         // CP-SAT doesn't use FULL_ROUND
      supplyTrips: totalSupply,
      transferTrips: totalTransfer,
      shuttleFromLivigno: totalResident,
      supplyFromLivigno: totalAdr,
      adrExceptionsUsed: totalAdr,       // Each ADR trip is an exception
    },
    dailyCapacity,
    constraints,
    solverStatus: solverResult.status,
  };
}
