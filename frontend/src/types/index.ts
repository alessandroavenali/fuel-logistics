// Enums
export type LocationType = 'SOURCE' | 'DESTINATION' | 'PARKING';
export type DriverType = 'RESIDENT' | 'ON_CALL' | 'EMERGENCY';
export type ScheduleStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type TripStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

// Models
export interface Location {
  id: string;
  name: string;
  type: LocationType;
  address: string;
  latitude?: number;
  longitude?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  plate: string;
  name?: string;
  maxTrailers: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Trailer {
  id: string;
  plate: string;
  name?: string;
  capacityLiters: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string;
  name: string;
  type: DriverType;
  phone?: string;
  adrLicenseExpiry?: string;
  adrCisternExpiry?: string;
  weeklyWorkingDays: number;
  hourlyCost?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Route {
  id: string;
  name: string;
  fromLocationId: string;
  toLocationId: string;
  distanceKm: number;
  durationMinutes: number;
  tollCost?: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  fromLocation?: Location;
  toLocation?: Location;
}

export interface Schedule {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  requiredLiters: number;
  status: ScheduleStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  trips?: Trip[];
  initialStates?: ScheduleInitialState[];
  _count?: {
    trips: number;
  };
}

export interface ScheduleInitialState {
  id: string;
  scheduleId: string;
  trailerId: string;
  locationId: string;
  isFull: boolean;
  createdAt: string;
  trailer?: Trailer;
  location?: Location;
}

export interface Trip {
  id: string;
  scheduleId: string;
  vehicleId: string;
  driverId: string;
  date: string;
  departureTime: string;
  returnTime?: string;
  status: TripStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  vehicle?: Vehicle;
  driver?: Driver;
  schedule?: Schedule;
  trailers?: TripTrailer[];
}

export interface TripTrailer {
  id: string;
  tripId: string;
  trailerId: string;
  litersLoaded: number;
  dropOffLocationId?: string;
  isPickup: boolean;
  createdAt: string;
  trailer?: Trailer;
  dropOffLocation?: Location;
}

export interface DriverWorkLog {
  id: string;
  driverId: string;
  date: string;
  drivingHours: number;
  workingHours: number;
  restHours: number;
  weekNumber: number;
  createdAt: string;
  updatedAt: string;
}

// API Request/Response types
export interface CreateLocationInput {
  name: string;
  type: LocationType;
  address: string;
  latitude?: number;
  longitude?: number;
  isActive?: boolean;
}

export interface CreateVehicleInput {
  plate: string;
  name?: string;
  maxTrailers?: number;
  isActive?: boolean;
}

export interface CreateTrailerInput {
  plate: string;
  name?: string;
  capacityLiters?: number;
  isActive?: boolean;
}

export interface CreateDriverInput {
  name: string;
  type: DriverType;
  phone?: string;
  adrLicenseExpiry?: string;
  adrCisternExpiry?: string;
  weeklyWorkingDays?: number;
  hourlyCost?: number;
  isActive?: boolean;
}

export interface CreateRouteInput {
  name: string;
  fromLocationId: string;
  toLocationId: string;
  distanceKm: number;
  durationMinutes: number;
  tollCost?: number;
  isActive?: boolean;
}

export interface CreateScheduleInput {
  name: string;
  startDate: string;
  endDate: string;
  requiredLiters: number;
  status?: ScheduleStatus;
  notes?: string;
  initialStates?: {
    trailerId: string;
    locationId: string;
    isFull: boolean;
  }[];
}

export interface CreateTripInput {
  scheduleId: string;
  vehicleId: string;
  driverId: string;
  date: string;
  departureTime: string;
  returnTime?: string;
  status?: TripStatus;
  notes?: string;
  trailers?: {
    trailerId: string;
    litersLoaded: number;
    dropOffLocationId?: string;
    isPickup?: boolean;
  }[];
}

// Validation types
export interface AdrViolation {
  type: string;
  severity: 'ERROR' | 'WARNING';
  message: string;
  driverId: string;
  driverName: string;
  date?: string;
  value?: number;
  limit?: number;
}

export interface AdrWarning {
  type: string;
  message: string;
  driverId: string;
  driverName: string;
  date?: string;
  currentValue?: number;
  limit?: number;
}

export interface ValidationResult {
  isValid: boolean;
  violations: AdrViolation[];
  warnings: AdrWarning[];
}

// Optimization types
export interface OptimizationResult {
  success: boolean;
  trips: Trip[];
  warnings: string[];
  statistics: {
    totalTrips: number;
    totalLiters: number;
    totalDrivingHours: number;
    trailersAtParking: number;
    unmetLiters: number;
  };
}

// Report types
export interface TripsReportSummary {
  totalTrips: number;
  totalLiters: number;
  completedTrips: number;
  cancelledTrips: number;
}

export interface DriverReport {
  id: string;
  name: string;
  type: DriverType;
  totalTrips: number;
  totalDrivingHours: number;
  totalWorkingHours: number;
  hourlyCost?: number;
  estimatedCost?: number;
}

export interface LitersReport {
  daily: { date: string; liters: number; trips: number }[];
  totalLiters: number;
  averageLitersPerDay: number;
}

export interface EfficiencyReport {
  scheduleId: string;
  scheduleName: string;
  requiredLiters: number;
  deliveredLiters: number;
  efficiency: number;
  totalTrips: number;
  completedTrips: number;
  status: ScheduleStatus;
}

// Resource status types
export interface TrailerStatus {
  id: string;
  plate: string;
  name: string | null;
  capacityLiters: number;
  isActive: boolean;
  currentLocation: 'SOURCE' | 'PARKING' | 'IN_TRANSIT';
  currentLocationId: string | null;
  currentLocationName: string | null;
  lastTripId: string | null;
  lastTripDate: string | null;
  availableFrom: string | null;
}

export interface VehicleStatus {
  id: string;
  plate: string;
  name: string | null;
  maxTrailers: number;
  isActive: boolean;
  status: 'AVAILABLE' | 'IN_USE';
  currentTrip: {
    id: string;
    driverName: string;
    departureTime: string;
    returnTime: string | null;
  } | null;
  tripsCount: number;
  trips: {
    id: string;
    date: string;
    departureTime: string;
    returnTime: string | null;
    status: TripStatus;
    driverName: string;
    trailers: string[];
  }[];
}

export interface DriverAvailability {
  id: string;
  name: string;
  type: DriverType;
  phone: string | null;
  hourlyCost: number | null;
  adrLicenseExpiry: string | null;
  adrCisternExpiry: string | null;
  status: 'AVAILABLE' | 'DRIVING';
  currentTrip: {
    id: string;
    vehiclePlate: string;
    departureTime: string;
    returnTime: string | null;
  } | null;
  periodStats: {
    tripsCount: number;
    estimatedHours: number;
  };
  weeklyStats: {
    hoursWorked: number;
    hoursRemaining: number;
    percentUsed: number;
  };
  daysOverLimit: string[];
  trips: {
    id: string;
    date: string;
    departureTime: string;
    returnTime: string | null;
    status: TripStatus;
    vehiclePlate: string;
    trailers: { plate: string; liters: number }[];
  }[];
}
