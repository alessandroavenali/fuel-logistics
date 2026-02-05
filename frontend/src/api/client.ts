const API_BASE = '/api';

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get('content-type') || '';
    let message = `HTTP ${response.status}`;
    let details: any;

    if (contentType.includes('application/json')) {
      const error = await response.json().catch(() => ({}));
      message = error.error || error.message || message;
      details = error.details;
    } else {
      const text = await response.text().catch(() => '');
      if (text.includes('504')) {
        message = 'Timeout del server: il calcolo ha richiesto troppo tempo';
      } else if (text.trim().length > 0) {
        message = `${message}: ${text.slice(0, 120)}`;
      }
    }

    throw new ApiError(response.status, message, details);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  return handleResponse<T>(response);
}

// Vehicles
export const vehiclesApi = {
  getAll: (isActive?: boolean) =>
    request<any[]>(`/vehicles${isActive !== undefined ? `?isActive=${isActive}` : ''}`),
  getById: (id: string) => request<any>(`/vehicles/${id}`),
  create: (data: any) => request<any>('/vehicles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/vehicles/${id}`, { method: 'DELETE' }),
  getStatus: (params?: { from?: string; to?: string; scheduleId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.scheduleId) searchParams.set('scheduleId', params.scheduleId);
    const query = searchParams.toString();
    return request<any[]>(`/vehicles/status${query ? `?${query}` : ''}`);
  },
};

// Trailers
export const trailersApi = {
  getAll: (isActive?: boolean) =>
    request<any[]>(`/trailers${isActive !== undefined ? `?isActive=${isActive}` : ''}`),
  getById: (id: string) => request<any>(`/trailers/${id}`),
  create: (data: any) => request<any>('/trailers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/trailers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/trailers/${id}`, { method: 'DELETE' }),
  getAtLocation: (locationId: string) => request<any[]>(`/trailers/location/${locationId}`),
  getStatus: (scheduleId?: string) => {
    const params = scheduleId ? `?scheduleId=${scheduleId}` : '';
    return request<any[]>(`/trailers/status${params}`);
  },
};

// Drivers
export const driversApi = {
  getAll: (params?: { isActive?: boolean; type?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
    if (params?.type) searchParams.set('type', params.type);
    const query = searchParams.toString();
    return request<any[]>(`/drivers${query ? `?${query}` : ''}`);
  },
  getById: (id: string) => request<any>(`/drivers/${id}`),
  create: (data: any) => request<any>('/drivers', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/drivers/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/drivers/${id}`, { method: 'DELETE' }),
  getWorkLog: (id: string, from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any[]>(`/drivers/${id}/worklog?${params}`);
  },
  getExpiring: (days?: number) =>
    request<any[]>(`/drivers/expiring${days ? `?days=${days}` : ''}`),
  getAvailability: (params?: { from?: string; to?: string; scheduleId?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.scheduleId) searchParams.set('scheduleId', params.scheduleId);
    const query = searchParams.toString();
    return request<any[]>(`/drivers/availability${query ? `?${query}` : ''}`);
  },
};

// Locations
export const locationsApi = {
  getAll: (params?: { isActive?: boolean; type?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.isActive !== undefined) searchParams.set('isActive', String(params.isActive));
    if (params?.type) searchParams.set('type', params.type);
    const query = searchParams.toString();
    return request<any[]>(`/locations${query ? `?${query}` : ''}`);
  },
  getById: (id: string) => request<any>(`/locations/${id}`),
  create: (data: any) => request<any>('/locations', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/locations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/locations/${id}`, { method: 'DELETE' }),
};

// Routes
export const routesApi = {
  getAll: (isActive?: boolean) =>
    request<any[]>(`/routes${isActive !== undefined ? `?isActive=${isActive}` : ''}`),
  getById: (id: string) => request<any>(`/routes/${id}`),
  create: (data: any) => request<any>('/routes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/routes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/routes/${id}`, { method: 'DELETE' }),
  calculate: (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) =>
    request<{ distanceKm: number; durationMinutes: number }>('/routes/calculate', {
      method: 'POST',
      body: JSON.stringify({ fromCoordinates: from, toCoordinates: to }),
    }),
};

// Schedules
export interface MaxCapacityResult {
  maxLiters: number;
  workingDays: number;
  daysWithDeliveries: number; // Giorni con almeno un autista disponibile
  breakdown: {
    livignoDriverShuttles: number;
    livignoSupplyTrips: number;     // SUPPLY da Livigno (10h)
    tiranoDriverShuttles: number;
    tiranoDriverFullRounds: number;
    supplyTrips: number;
    transferTrips: number;          // Sversamenti rimorchio → serbatoio integrato
    shuttleFromLivigno: number;     // SHUTTLE_FROM_LIVIGNO (4.5h)
    supplyFromLivigno: number;      // SUPPLY_FROM_LIVIGNO (10h)
    adrExceptionsUsed: number;      // Eccezioni ADR (10h invece di 9h)
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
  startDate: string;
  endDate: string;
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
  timeLimitSeconds?: number;
  numSearchWorkers?: number;
}

export interface MaxCapacityJobCreated {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  createdAt: string;
}

export interface MaxCapacityJobStatus {
  jobId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  elapsedMs: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: MaxCapacityResult;
  error?: string;
  progress?: {
    seq?: number;
    solutions?: number;
    objective_deliveries?: number;
    objective_liters?: number;
    objective_bound_deliveries?: number;
    objective_bound_liters?: number;
    elapsed_seconds?: number;
  };
}

export interface OptimizeJobStatus {
  jobId: string;
  scheduleId: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  elapsedMs: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  result?: any;
  error?: string;
  progress?: {
    seq?: number;
    solutions?: number;
    objective_deliveries?: number;
    objective_liters?: number;
    objective_bound_deliveries?: number;
    objective_bound_liters?: number;
    elapsed_seconds?: number;
  };
}

export interface OptimizerSelfCheckResult {
  scheduleId: string;
  persistedTrips: number;
  persistedLiters: number;
  plannedTrips: number;
  plannedLiters: number;
  solverObjectiveLiters: number;
  solverStatus?: string;
  mismatch: boolean;
  warnings: string[];
}

export const schedulesApi = {
  getAll: (status?: string) =>
    request<any[]>(`/schedules${status ? `?status=${status}` : ''}`),
  getById: (id: string) => request<any>(`/schedules/${id}`),
  create: (data: any) => request<any>('/schedules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: any) =>
    request<any>(`/schedules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/schedules/${id}`, { method: 'DELETE' }),
  optimize: (id: string, driverAvailability?: DriverAvailabilityInput[]) =>
    request<any>(`/schedules/${id}/optimize`, {
      method: 'POST',
      body: JSON.stringify({ driverAvailability })
    }),
  optimizerSelfCheck: (id: string, driverAvailability?: DriverAvailabilityInput[]) =>
    request<OptimizerSelfCheckResult>(`/schedules/${id}/optimizer-self-check`, {
      method: 'POST',
      body: JSON.stringify({ driverAvailability })
    }),
  confirm: (id: string) => request<any>(`/schedules/${id}/confirm`, { method: 'PUT' }),
  validate: (id: string) => request<any>(`/schedules/${id}/validate`, { method: 'POST' }),
  calculateMax: (data: CalculateMaxInput) =>
    request<MaxCapacityResult>('/schedules/calculate-max', { method: 'POST', body: JSON.stringify(data) }),
  startCalculateMaxJob: (data: CalculateMaxInput) =>
    request<MaxCapacityJobCreated>('/schedules/calculate-max/jobs', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getCalculateMaxJob: (jobId: string) =>
    request<MaxCapacityJobStatus>(`/schedules/calculate-max/jobs/${jobId}`),
  stopCalculateMaxJob: (jobId: string) =>
    request<any>(`/schedules/calculate-max/jobs/${jobId}/stop`, { method: 'POST' }),
  startOptimizeJob: (scheduleId: string, data: { driverAvailability?: DriverAvailabilityInput[]; timeLimitSeconds?: number }) =>
    request<any>(`/schedules/${scheduleId}/optimize/jobs`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    }),
  getOptimizeJob: (scheduleId: string, jobId: string) =>
    request<OptimizeJobStatus>(`/schedules/${scheduleId}/optimize/jobs/${jobId}`),
  stopOptimizeJob: (scheduleId: string, jobId: string) =>
    request<any>(`/schedules/${scheduleId}/optimize/jobs/${jobId}/stop`, { method: 'POST' }),
  getTrips: (id: string) => request<any[]>(`/schedules/${id}/trips`),
  createTrip: (scheduleId: string, data: any) =>
    request<any>(`/schedules/${scheduleId}/trips`, { method: 'POST', body: JSON.stringify(data) }),
  updateTrip: (scheduleId: string, tripId: string, data: any) =>
    request<any>(`/schedules/${scheduleId}/trips/${tripId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTrip: (scheduleId: string, tripId: string) =>
    request<void>(`/schedules/${scheduleId}/trips/${tripId}`, { method: 'DELETE' }),
};

// Reports
export const reportsApi = {
  getTrips: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any>(`/reports/trips?${params}`);
  },
  getDrivers: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any[]>(`/reports/drivers?${params}`);
  },
  getCosts: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any>(`/reports/costs?${params}`);
  },
  getLiters: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any>(`/reports/liters?${params}`);
  },
  getEfficiency: (from?: string, to?: string) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any[]>(`/reports/efficiency?${params}`);
  },
};

export { ApiError };
