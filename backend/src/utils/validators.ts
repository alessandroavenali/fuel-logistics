import { z } from 'zod';

// Enums
export const LocationTypeEnum = z.enum(['SOURCE', 'DESTINATION', 'PARKING']);
export const DriverTypeEnum = z.enum(['RESIDENT', 'ON_CALL', 'EMERGENCY']);
export const ScheduleStatusEnum = z.enum(['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED']);
export const TripStatusEnum = z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export const TripTypeEnum = z.enum(['SHUTTLE_LIVIGNO', 'SUPPLY_MILANO', 'FULL_ROUND']);

// Location schemas
export const createLocationSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: LocationTypeEnum,
  address: z.string().min(1, 'Address is required'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isActive: z.boolean().optional(),
});

export const updateLocationSchema = createLocationSchema.partial();

// Vehicle schemas
export const createVehicleSchema = z.object({
  plate: z.string().min(1, 'Plate is required'),
  name: z.string().optional(),
  maxTrailers: z.number().int().min(1).max(3).optional(),
  isActive: z.boolean().optional(),
});

export const updateVehicleSchema = createVehicleSchema.partial();

// Trailer schemas
export const createTrailerSchema = z.object({
  plate: z.string().min(1, 'Plate is required'),
  name: z.string().optional(),
  capacityLiters: z.number().int().min(1000).optional(),
  isActive: z.boolean().optional(),
});

export const updateTrailerSchema = createTrailerSchema.partial();

// Driver schemas
export const createDriverSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  type: DriverTypeEnum,
  phone: z.string().optional(),
  adrLicenseExpiry: z.string().datetime().optional(),
  adrCisternExpiry: z.string().datetime().optional(),
  weeklyWorkingDays: z.number().int().min(1).max(7).optional(),
  hourlyCost: z.number().min(0).optional(),
  baseLocationId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const updateDriverSchema = createDriverSchema.partial();

// Route schemas
export const createRouteSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  fromLocationId: z.string().uuid(),
  toLocationId: z.string().uuid(),
  distanceKm: z.number().min(0),
  durationMinutes: z.number().int().min(0),
  tollCost: z.number().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const updateRouteSchema = createRouteSchema.partial();

// Schedule schemas
export const createScheduleSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  requiredLiters: z.number().int().min(0),
  status: ScheduleStatusEnum.optional(),
  notes: z.string().optional(),
  includeWeekend: z.boolean().optional(),
  initialStates: z.array(z.object({
    trailerId: z.string().uuid(),
    locationId: z.string().uuid(),
    isFull: z.boolean()
  })).optional(),
  vehicleStates: z.array(z.object({
    vehicleId: z.string().uuid(),
    locationId: z.string().uuid(),
  })).optional(),
});

export const updateScheduleSchema = createScheduleSchema.partial();

// Trip schemas
export const createTripSchema = z.object({
  scheduleId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  driverId: z.string().uuid(),
  date: z.string().datetime(),
  departureTime: z.string().datetime(),
  returnTime: z.string().datetime().optional(),
  tripType: TripTypeEnum.optional(),
  status: TripStatusEnum.optional(),
  notes: z.string().optional(),
  trailers: z
    .array(
      z.object({
        trailerId: z.string().uuid(),
        litersLoaded: z.number().int().min(0),
        dropOffLocationId: z.string().uuid().optional(),
        isPickup: z.boolean().optional(),
      })
    )
    .optional(),
});

export const updateTripSchema = createTripSchema.partial();

// DriverWorkLog schemas
export const createDriverWorkLogSchema = z.object({
  driverId: z.string().uuid(),
  date: z.string().datetime(),
  drivingHours: z.number().min(0),
  workingHours: z.number().min(0),
  restHours: z.number().min(0),
  weekNumber: z.number().int().min(1).max(53),
});

// Route calculation schema
export const calculateRouteSchema = z.object({
  fromCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
  toCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }),
});

// Optimize schedule schema
export const optimizeScheduleSchema = z.object({
  scheduleId: z.string().uuid(),
});
