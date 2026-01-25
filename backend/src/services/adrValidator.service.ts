import { PrismaClient, Driver, Trip, DriverWorkLog } from '@prisma/client';

// ADR Limits for driving hours and rest periods
export const ADR_LIMITS = {
  maxDailyDrivingHours: 9,
  maxExtendedDailyHours: 10,
  maxExtendedDaysPerWeek: 2,
  maxWeeklyDrivingHours: 56,
  maxBiweeklyDrivingHours: 90,
  breakAfterDrivingMinutes: 270, // 4h30
  requiredBreakMinutes: 45,
  minDailyRestHours: 11,
  minReducedRestHours: 9,
  maxReducedRestPerPeriod: 3,
  minWeeklyRestHours: 45,
  minReducedWeeklyRestHours: 24,
};

export interface AdrViolation {
  type: 'DAILY_DRIVING' | 'WEEKLY_DRIVING' | 'BIWEEKLY_DRIVING' | 'DAILY_REST' | 'WEEKLY_REST' | 'LICENSE_EXPIRED';
  severity: 'ERROR' | 'WARNING';
  message: string;
  driverId: string;
  driverName: string;
  date?: string;
  value?: number;
  limit?: number;
}

export interface AdrWarning {
  type: 'APPROACHING_LIMIT' | 'LICENSE_EXPIRING' | 'EXTENDED_DAY_USED';
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

export async function validateTripsForSchedule(
  prisma: PrismaClient,
  scheduleId: string
): Promise<ValidationResult> {
  const violations: AdrViolation[] = [];
  const warnings: AdrWarning[] = [];

  // Get schedule with trips
  const schedule = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    include: {
      trips: {
        include: {
          driver: true,
        },
        orderBy: { date: 'asc' },
      },
    },
  });

  if (!schedule) {
    return {
      isValid: false,
      violations: [
        {
          type: 'DAILY_DRIVING',
          severity: 'ERROR',
          message: 'Schedule not found',
          driverId: '',
          driverName: '',
        },
      ],
      warnings: [],
    };
  }

  // Group trips by driver
  const tripsByDriver = new Map<string, typeof schedule.trips>();
  for (const trip of schedule.trips) {
    const driverTrips = tripsByDriver.get(trip.driverId) || [];
    driverTrips.push(trip);
    tripsByDriver.set(trip.driverId, driverTrips);
  }

  // Validate each driver
  for (const [driverId, trips] of tripsByDriver) {
    const driver = trips[0].driver;

    // Check license expiry
    const licenseCheck = checkLicenseExpiry(driver, schedule.startDate, schedule.endDate);
    violations.push(...licenseCheck.violations);
    warnings.push(...licenseCheck.warnings);

    // Get existing work logs for the driver in the schedule period
    const existingLogs = await prisma.driverWorkLog.findMany({
      where: {
        driverId,
        date: {
          gte: schedule.startDate,
          lte: schedule.endDate,
        },
      },
    });

    // Validate daily driving hours
    const dailyCheck = validateDailyDrivingHours(driver, trips, existingLogs);
    violations.push(...dailyCheck.violations);
    warnings.push(...dailyCheck.warnings);

    // Validate weekly driving hours
    const weeklyCheck = await validateWeeklyDrivingHours(prisma, driver, trips, schedule.startDate);
    violations.push(...weeklyCheck.violations);
    warnings.push(...weeklyCheck.warnings);
  }

  return {
    isValid: violations.filter((v) => v.severity === 'ERROR').length === 0,
    violations,
    warnings,
  };
}

function checkLicenseExpiry(
  driver: Driver,
  startDate: Date,
  endDate: Date
): { violations: AdrViolation[]; warnings: AdrWarning[] } {
  const violations: AdrViolation[] = [];
  const warnings: AdrWarning[] = [];

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  // Check ADR license
  if (driver.adrLicenseExpiry) {
    if (driver.adrLicenseExpiry < endDate) {
      violations.push({
        type: 'LICENSE_EXPIRED',
        severity: 'ERROR',
        message: `ADR license expires on ${driver.adrLicenseExpiry.toISOString().split('T')[0]}`,
        driverId: driver.id,
        driverName: driver.name,
        date: driver.adrLicenseExpiry.toISOString(),
      });
    } else if (driver.adrLicenseExpiry < thirtyDaysFromNow) {
      warnings.push({
        type: 'LICENSE_EXPIRING',
        message: `ADR license expiring soon: ${driver.adrLicenseExpiry.toISOString().split('T')[0]}`,
        driverId: driver.id,
        driverName: driver.name,
        date: driver.adrLicenseExpiry.toISOString(),
      });
    }
  }

  // Check cistern specialization
  if (driver.adrCisternExpiry) {
    if (driver.adrCisternExpiry < endDate) {
      violations.push({
        type: 'LICENSE_EXPIRED',
        severity: 'ERROR',
        message: `Cistern specialization expires on ${driver.adrCisternExpiry.toISOString().split('T')[0]}`,
        driverId: driver.id,
        driverName: driver.name,
        date: driver.adrCisternExpiry.toISOString(),
      });
    } else if (driver.adrCisternExpiry < thirtyDaysFromNow) {
      warnings.push({
        type: 'LICENSE_EXPIRING',
        message: `Cistern specialization expiring soon: ${driver.adrCisternExpiry.toISOString().split('T')[0]}`,
        driverId: driver.id,
        driverName: driver.name,
        date: driver.adrCisternExpiry.toISOString(),
      });
    }
  }

  return { violations, warnings };
}

function validateDailyDrivingHours(
  driver: Driver,
  trips: Trip[],
  existingLogs: DriverWorkLog[]
): { violations: AdrViolation[]; warnings: AdrWarning[] } {
  const violations: AdrViolation[] = [];
  const warnings: AdrWarning[] = [];

  // Group trips by date
  const tripsByDate = new Map<string, Trip[]>();
  for (const trip of trips) {
    const dateKey = trip.date.toISOString().split('T')[0];
    const dateTrips = tripsByDate.get(dateKey) || [];
    dateTrips.push(trip);
    tripsByDate.set(dateKey, dateTrips);
  }

  // Check each day
  for (const [dateKey, dayTrips] of tripsByDate) {
    // Estimate driving hours for this day's trips
    // Assuming average trip duration of 8 hours (Milano-Tirano-Livigno round trip)
    const estimatedHours = dayTrips.length * 8;

    // Get existing hours from logs
    const existingLog = existingLogs.find(
      (log) => log.date.toISOString().split('T')[0] === dateKey
    );
    const existingHours = existingLog?.drivingHours || 0;

    const totalHours = estimatedHours + existingHours;

    if (totalHours > ADR_LIMITS.maxExtendedDailyHours) {
      violations.push({
        type: 'DAILY_DRIVING',
        severity: 'ERROR',
        message: `Daily driving hours exceeded on ${dateKey}: ${totalHours}h (max ${ADR_LIMITS.maxExtendedDailyHours}h)`,
        driverId: driver.id,
        driverName: driver.name,
        date: dateKey,
        value: totalHours,
        limit: ADR_LIMITS.maxExtendedDailyHours,
      });
    } else if (totalHours > ADR_LIMITS.maxDailyDrivingHours) {
      warnings.push({
        type: 'EXTENDED_DAY_USED',
        message: `Extended daily driving on ${dateKey}: ${totalHours}h (max 2 per week allowed)`,
        driverId: driver.id,
        driverName: driver.name,
        date: dateKey,
        currentValue: totalHours,
        limit: ADR_LIMITS.maxDailyDrivingHours,
      });
    } else if (totalHours > ADR_LIMITS.maxDailyDrivingHours * 0.8) {
      warnings.push({
        type: 'APPROACHING_LIMIT',
        message: `Approaching daily limit on ${dateKey}: ${totalHours}h / ${ADR_LIMITS.maxDailyDrivingHours}h`,
        driverId: driver.id,
        driverName: driver.name,
        date: dateKey,
        currentValue: totalHours,
        limit: ADR_LIMITS.maxDailyDrivingHours,
      });
    }
  }

  return { violations, warnings };
}

async function validateWeeklyDrivingHours(
  prisma: PrismaClient,
  driver: Driver,
  trips: Trip[],
  scheduleStartDate: Date
): Promise<{ violations: AdrViolation[]; warnings: AdrWarning[] }> {
  const violations: AdrViolation[] = [];
  const warnings: AdrWarning[] = [];

  // Get the week numbers involved
  const weeks = new Set<number>();
  for (const trip of trips) {
    weeks.add(getWeekNumber(trip.date));
  }

  for (const weekNum of weeks) {
    // Get existing work logs for this week
    const weekStart = getWeekStart(scheduleStartDate.getFullYear(), weekNum);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const weekLogs = await prisma.driverWorkLog.findMany({
      where: {
        driverId: driver.id,
        weekNumber: weekNum,
        date: {
          gte: weekStart,
          lte: weekEnd,
        },
      },
    });

    const existingHours = weekLogs.reduce((sum, log) => sum + log.drivingHours, 0);

    // Count trips in this week
    const tripsInWeek = trips.filter((t) => getWeekNumber(t.date) === weekNum);
    const estimatedHours = tripsInWeek.length * 8;

    const totalHours = existingHours + estimatedHours;

    if (totalHours > ADR_LIMITS.maxWeeklyDrivingHours) {
      violations.push({
        type: 'WEEKLY_DRIVING',
        severity: 'ERROR',
        message: `Weekly driving hours exceeded in week ${weekNum}: ${totalHours}h (max ${ADR_LIMITS.maxWeeklyDrivingHours}h)`,
        driverId: driver.id,
        driverName: driver.name,
        value: totalHours,
        limit: ADR_LIMITS.maxWeeklyDrivingHours,
      });
    } else if (totalHours > ADR_LIMITS.maxWeeklyDrivingHours * 0.8) {
      warnings.push({
        type: 'APPROACHING_LIMIT',
        message: `Approaching weekly limit in week ${weekNum}: ${totalHours}h / ${ADR_LIMITS.maxWeeklyDrivingHours}h`,
        driverId: driver.id,
        driverName: driver.name,
        currentValue: totalHours,
        limit: ADR_LIMITS.maxWeeklyDrivingHours,
      });
    }
  }

  return { violations, warnings };
}

export function validateSingleTrip(
  driver: Driver,
  tripDate: Date,
  estimatedDrivingHours: number,
  existingDailyHours: number,
  existingWeeklyHours: number
): ValidationResult {
  const violations: AdrViolation[] = [];
  const warnings: AdrWarning[] = [];

  const totalDailyHours = existingDailyHours + estimatedDrivingHours;
  const totalWeeklyHours = existingWeeklyHours + estimatedDrivingHours;

  // Daily check
  if (totalDailyHours > ADR_LIMITS.maxExtendedDailyHours) {
    violations.push({
      type: 'DAILY_DRIVING',
      severity: 'ERROR',
      message: `Would exceed daily driving limit: ${totalDailyHours}h`,
      driverId: driver.id,
      driverName: driver.name,
      date: tripDate.toISOString(),
      value: totalDailyHours,
      limit: ADR_LIMITS.maxExtendedDailyHours,
    });
  } else if (totalDailyHours > ADR_LIMITS.maxDailyDrivingHours) {
    warnings.push({
      type: 'EXTENDED_DAY_USED',
      message: `Would use extended daily driving: ${totalDailyHours}h`,
      driverId: driver.id,
      driverName: driver.name,
      date: tripDate.toISOString(),
      currentValue: totalDailyHours,
      limit: ADR_LIMITS.maxDailyDrivingHours,
    });
  }

  // Weekly check
  if (totalWeeklyHours > ADR_LIMITS.maxWeeklyDrivingHours) {
    violations.push({
      type: 'WEEKLY_DRIVING',
      severity: 'ERROR',
      message: `Would exceed weekly driving limit: ${totalWeeklyHours}h`,
      driverId: driver.id,
      driverName: driver.name,
      value: totalWeeklyHours,
      limit: ADR_LIMITS.maxWeeklyDrivingHours,
    });
  }

  // License check
  if (driver.adrLicenseExpiry && driver.adrLicenseExpiry < tripDate) {
    violations.push({
      type: 'LICENSE_EXPIRED',
      severity: 'ERROR',
      message: 'ADR license will be expired',
      driverId: driver.id,
      driverName: driver.name,
      date: driver.adrLicenseExpiry.toISOString(),
    });
  }

  if (driver.adrCisternExpiry && driver.adrCisternExpiry < tripDate) {
    violations.push({
      type: 'LICENSE_EXPIRED',
      severity: 'ERROR',
      message: 'Cistern specialization will be expired',
      driverId: driver.id,
      driverName: driver.name,
      date: driver.adrCisternExpiry.toISOString(),
    });
  }

  return {
    isValid: violations.filter((v) => v.severity === 'ERROR').length === 0,
    violations,
    warnings,
  };
}

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function getWeekStart(year: number, weekNumber: number): Date {
  const simple = new Date(year, 0, 1 + (weekNumber - 1) * 7);
  const dow = simple.getDay();
  const weekStart = simple;
  if (dow <= 4) {
    weekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    weekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return weekStart;
}
