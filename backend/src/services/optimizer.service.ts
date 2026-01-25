import { PrismaClient, Driver, Vehicle, Trailer, Location, Schedule } from '@prisma/client';
import { validateSingleTrip, ADR_LIMITS } from './adrValidator.service.js';

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
  };
}

interface GeneratedTrip {
  date: Date;
  departureTime: Date;
  returnTime: Date;
  vehicleId: string;
  driverId: string;
  trailers: {
    trailerId: string;
    litersLoaded: number;
    dropOffLocationId?: string;
    isPickup: boolean;
  }[];
}

interface AvailabilityTracker {
  driverHoursByDate: Map<string, number>;
  driverHoursByWeek: Map<string, number>;
  vehicleSchedule: Map<string, Date[]>;
  trailerLocations: Map<string, string | null>; // null = available at source, string = locationId where parked
  trailerIsFull: Map<string, boolean>; // Track if trailer is full
}

const LITERS_PER_TRAILER = 17500;
const ESTIMATED_TRIP_HOURS = 8; // Average round trip duration
const DEFAULT_DEPARTURE_HOUR = 6; // 6:00 AM

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
    prisma.driver.findMany({ where: { isActive: true } }),
    prisma.vehicle.findMany({ where: { isActive: true } }),
    prisma.trailer.findMany({ where: { isActive: true } }),
    prisma.location.findMany({ where: { isActive: true } }),
  ]);

  if (drivers.length === 0) {
    throw new Error('No active drivers available');
  }
  if (vehicles.length === 0) {
    throw new Error('No active vehicles available');
  }
  if (trailers.length === 0) {
    throw new Error('No active trailers available');
  }

  // Find parking location (Tirano)
  const parkingLocation = locations.find((l) => l.type === 'PARKING');

  // Calculate number of trips needed
  const litersPerTrip = LITERS_PER_TRAILER; // One trailer goes all the way to Livigno
  const tripsNeeded = Math.ceil(schedule.requiredLiters / litersPerTrip);

  // Get available working days
  const workingDays = getWorkingDays(schedule.startDate, schedule.endDate);

  if (workingDays.length === 0) {
    throw new Error('No working days in schedule period');
  }

  // Initialize availability tracker
  const tracker: AvailabilityTracker = {
    driverHoursByDate: new Map(),
    driverHoursByWeek: new Map(),
    vehicleSchedule: new Map(),
    trailerLocations: new Map(),
    trailerIsFull: new Map(),
  };

  // Build initial states map from schedule
  const initialStatesMap = new Map<string, { locationId: string | null; isFull: boolean }>();
  for (const state of schedule.initialStates) {
    // For SOURCE locations, we use null (available at source)
    // For PARKING or DESTINATION, we use the locationId
    const locationId = state.location.type === 'SOURCE' ? null : state.locationId;
    initialStatesMap.set(state.trailerId, { locationId, isFull: state.isFull });
  }

  // Initialize trailer locations using initial states if provided, otherwise at source (null)
  for (const trailer of trailers) {
    const initialState = initialStatesMap.get(trailer.id);
    if (initialState) {
      tracker.trailerLocations.set(trailer.id, initialState.locationId);
      tracker.trailerIsFull.set(trailer.id, initialState.isFull);
    } else {
      // Default: at source, empty
      tracker.trailerLocations.set(trailer.id, null);
      tracker.trailerIsFull.set(trailer.id, false);
    }
  }

  // Fetch existing work logs for drivers
  const existingLogs = await prisma.driverWorkLog.findMany({
    where: {
      date: {
        gte: schedule.startDate,
        lte: schedule.endDate,
      },
    },
  });

  // Pre-populate tracker with existing hours
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

  const generatedTrips: GeneratedTrip[] = [];
  let remainingLiters = schedule.requiredLiters;
  let dayIndex = 0;
  let trailersAtParking = 0;

  // Generate trips
  while (remainingLiters > 0 && dayIndex < workingDays.length * 3) {
    const currentDay = workingDays[dayIndex % workingDays.length];
    const dateKey = currentDay.toISOString().split('T')[0];

    // Find available driver
    const availableDriver = findAvailableDriver(
      drivers,
      currentDay,
      tracker,
      ESTIMATED_TRIP_HOURS
    );

    if (!availableDriver) {
      dayIndex++;
      if (dayIndex >= workingDays.length * 2) {
        warnings.push('Not enough driver availability to complete all trips');
        break;
      }
      continue;
    }

    // Find available vehicle
    const availableVehicle = findAvailableVehicle(vehicles, currentDay, tracker);

    if (!availableVehicle) {
      dayIndex++;
      continue;
    }

    // Find available trailers
    const availableTrailers = findAvailableTrailers(
      trailers,
      tracker,
      availableVehicle.maxTrailers,
      parkingLocation?.id
    );

    if (availableTrailers.length === 0) {
      dayIndex++;
      continue;
    }

    // Create trip
    const departureTime = new Date(currentDay);
    departureTime.setHours(DEFAULT_DEPARTURE_HOUR, 0, 0, 0);

    const returnTime = new Date(departureTime);
    returnTime.setHours(returnTime.getHours() + ESTIMATED_TRIP_HOURS);

    const tripTrailers: GeneratedTrip['trailers'] = [];
    let tripLiters = 0;

    for (let i = 0; i < availableTrailers.length && i < availableVehicle.maxTrailers; i++) {
      const trailerInfo = availableTrailers[i];
      const trailer = trailers.find((t) => t.id === trailerInfo.trailerId)!;

      if (i === 0) {
        // First trailer goes to Livigno
        tripTrailers.push({
          trailerId: trailer.id,
          litersLoaded: trailer.capacityLiters,
          isPickup: trailerInfo.isPickup,
        });
        tripLiters += trailer.capacityLiters;
        tracker.trailerLocations.set(trailer.id, null); // Returns to source
        tracker.trailerIsFull.set(trailer.id, false); // After delivery, it's empty
      } else if (parkingLocation) {
        // Second trailer stays at Tirano
        tripTrailers.push({
          trailerId: trailer.id,
          litersLoaded: trailer.capacityLiters,
          dropOffLocationId: parkingLocation.id,
          isPickup: trailerInfo.isPickup,
        });
        tracker.trailerLocations.set(trailer.id, parkingLocation.id);
        tracker.trailerIsFull.set(trailer.id, true); // Left at parking full
        trailersAtParking++;
      }
    }

    if (tripTrailers.length === 0) {
      dayIndex++;
      continue;
    }

    generatedTrips.push({
      date: currentDay,
      departureTime,
      returnTime,
      vehicleId: availableVehicle.id,
      driverId: availableDriver.id,
      trailers: tripTrailers,
    });

    // Update tracker
    const driverDateKey = `${availableDriver.id}-${dateKey}`;
    const weekNum = getWeekNumber(currentDay);
    const weekKey = `${availableDriver.id}-${weekNum}`;

    tracker.driverHoursByDate.set(
      driverDateKey,
      (tracker.driverHoursByDate.get(driverDateKey) || 0) + ESTIMATED_TRIP_HOURS
    );
    tracker.driverHoursByWeek.set(
      weekKey,
      (tracker.driverHoursByWeek.get(weekKey) || 0) + ESTIMATED_TRIP_HOURS
    );

    const vehicleSchedule = tracker.vehicleSchedule.get(availableVehicle.id) || [];
    vehicleSchedule.push(currentDay);
    tracker.vehicleSchedule.set(availableVehicle.id, vehicleSchedule);

    remainingLiters -= tripLiters;
    dayIndex++;
  }

  // Save trips to database
  if (generatedTrips.length > 0) {
    // Delete existing trips for this schedule
    await prisma.trip.deleteMany({
      where: { scheduleId },
    });

    // Create new trips
    for (const trip of generatedTrips) {
      await prisma.trip.create({
        data: {
          scheduleId,
          vehicleId: trip.vehicleId,
          driverId: trip.driverId,
          date: trip.date,
          departureTime: trip.departureTime,
          returnTime: trip.returnTime,
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

  return {
    success: remainingLiters <= 0,
    trips: generatedTrips,
    warnings,
    statistics: {
      totalTrips: generatedTrips.length,
      totalLiters,
      totalDrivingHours: generatedTrips.length * ESTIMATED_TRIP_HOURS,
      trailersAtParking,
      unmetLiters: Math.max(0, remainingLiters),
    },
  };
}

function findAvailableDriver(
  drivers: Driver[],
  date: Date,
  tracker: AvailabilityTracker,
  tripHours: number
): Driver | null {
  const dateKey = date.toISOString().split('T')[0];
  const weekNum = getWeekNumber(date);
  const dayOfWeek = date.getDay();

  // Prioritize resident drivers, then on-call
  const sortedDrivers = [...drivers].sort((a, b) => {
    if (a.type === 'RESIDENT' && b.type !== 'RESIDENT') return -1;
    if (a.type !== 'RESIDENT' && b.type === 'RESIDENT') return 1;
    return 0;
  });

  for (const driver of sortedDrivers) {
    const driverDateKey = `${driver.id}-${dateKey}`;
    const weekKey = `${driver.id}-${weekNum}`;

    const currentDailyHours = tracker.driverHoursByDate.get(driverDateKey) || 0;
    const currentWeeklyHours = tracker.driverHoursByWeek.get(weekKey) || 0;

    // Check if driver works on this day of week
    if (dayOfWeek === 0 || dayOfWeek > driver.weeklyWorkingDays) {
      continue;
    }

    // Validate with ADR
    const validation = validateSingleTrip(
      driver,
      date,
      tripHours,
      currentDailyHours,
      currentWeeklyHours
    );

    if (validation.isValid) {
      return driver;
    }
  }

  return null;
}

function findAvailableVehicle(
  vehicles: Vehicle[],
  date: Date,
  tracker: AvailabilityTracker
): Vehicle | null {
  const dateKey = date.toISOString().split('T')[0];

  for (const vehicle of vehicles) {
    const schedule = tracker.vehicleSchedule.get(vehicle.id) || [];
    const usedToday = schedule.some(
      (d) => d.toISOString().split('T')[0] === dateKey
    );

    if (!usedToday) {
      return vehicle;
    }
  }

  return null;
}

function findAvailableTrailers(
  trailers: Trailer[],
  tracker: AvailabilityTracker,
  maxTrailers: number,
  parkingLocationId?: string
): { trailerId: string; isPickup: boolean; isFull: boolean }[] {
  const result: { trailerId: string; isPickup: boolean; isFull: boolean }[] = [];

  // First, check for trailers at parking (to pick up) - prioritize full trailers
  if (parkingLocationId) {
    // First pass: full trailers at parking
    for (const trailer of trailers) {
      if (result.length >= maxTrailers) break;

      const location = tracker.trailerLocations.get(trailer.id);
      const isFull = tracker.trailerIsFull.get(trailer.id) || false;
      if (location === parkingLocationId && isFull) {
        result.push({ trailerId: trailer.id, isPickup: true, isFull });
      }
    }
    // Second pass: empty trailers at parking
    for (const trailer of trailers) {
      if (result.length >= maxTrailers) break;

      const location = tracker.trailerLocations.get(trailer.id);
      const isFull = tracker.trailerIsFull.get(trailer.id) || false;
      if (location === parkingLocationId && !isFull) {
        if (!result.some((r) => r.trailerId === trailer.id)) {
          result.push({ trailerId: trailer.id, isPickup: true, isFull });
        }
      }
    }
  }

  // Then, add trailers from source (null location)
  for (const trailer of trailers) {
    if (result.length >= maxTrailers) break;

    const location = tracker.trailerLocations.get(trailer.id);
    const isFull = tracker.trailerIsFull.get(trailer.id) || false;
    if (location === null) {
      // Already used in this trip
      if (!result.some((r) => r.trailerId === trailer.id)) {
        result.push({ trailerId: trailer.id, isPickup: false, isFull });
      }
    }
  }

  return result;
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
