import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createDriverSchema, updateDriverSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getDrivers(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { isActive, type } = req.query;

    const drivers = await prisma.driver.findMany({
      where: {
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(type && { type: type as any }),
      },
      orderBy: { name: 'asc' },
    });

    res.json(drivers);
  } catch (error) {
    next(error);
  }
}

export async function getDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const driver = await prisma.driver.findUnique({
      where: { id },
      include: {
        trips: {
          take: 10,
          orderBy: { date: 'desc' },
        },
        workLogs: {
          take: 14,
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!driver) {
      throw new AppError(404, 'Driver not found');
    }

    res.json(driver);
  } catch (error) {
    next(error);
  }
}

export async function createDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createDriverSchema.parse(req.body);

    const driver = await prisma.driver.create({
      data: {
        ...data,
        adrLicenseExpiry: data.adrLicenseExpiry ? new Date(data.adrLicenseExpiry) : undefined,
        adrCisternExpiry: data.adrCisternExpiry ? new Date(data.adrCisternExpiry) : undefined,
      },
    });

    res.status(201).json(driver);
  } catch (error) {
    next(error);
  }
}

export async function updateDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateDriverSchema.parse(req.body);

    const driver = await prisma.driver.update({
      where: { id },
      data: {
        ...data,
        adrLicenseExpiry: data.adrLicenseExpiry ? new Date(data.adrLicenseExpiry) : undefined,
        adrCisternExpiry: data.adrCisternExpiry ? new Date(data.adrCisternExpiry) : undefined,
      },
    });

    res.json(driver);
  } catch (error) {
    next(error);
  }
}

export async function deleteDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.driver.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function getDriverWorkLog(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const { from, to } = req.query;

    const workLogs = await prisma.driverWorkLog.findMany({
      where: {
        driverId: id,
        ...(from && to && {
          date: {
            gte: new Date(from as string),
            lte: new Date(to as string),
          },
        }),
      },
      orderBy: { date: 'desc' },
    });

    res.json(workLogs);
  } catch (error) {
    next(error);
  }
}

export async function getDriversWithExpiringLicenses(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const daysAhead = parseInt(req.query.days as string) || 30;
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + daysAhead);

    const drivers = await prisma.driver.findMany({
      where: {
        isActive: true,
        OR: [
          {
            adrLicenseExpiry: {
              lte: futureDate,
            },
          },
          {
            adrCisternExpiry: {
              lte: futureDate,
            },
          },
        ],
      },
      orderBy: { name: 'asc' },
    });

    res.json(drivers);
  } catch (error) {
    next(error);
  }
}

// Disponibilità autisti con ore lavorate/rimanenti
export async function getDriversAvailability(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to, scheduleId } = req.query;

    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    // ADR limits
    const MAX_DAILY_HOURS = 9;
    const MAX_WEEKLY_HOURS = 56;

    // Get trips in period
    const whereTrips: any = {
      status: { in: ['PLANNED', 'IN_PROGRESS', 'COMPLETED'] },
    };

    if (scheduleId) {
      whereTrips.scheduleId = scheduleId as string;
    }

    if (from || to) {
      whereTrips.departureTime = {};
      if (from) whereTrips.departureTime.gte = new Date(from as string);
      if (to) whereTrips.departureTime.lte = new Date(to as string);
    }

    const trips = await prisma.trip.findMany({
      where: whereTrips,
      include: {
        vehicle: { select: { plate: true } },
        trailers: {
          include: {
            trailer: { select: { plate: true } },
          },
        },
      },
      orderBy: { departureTime: 'asc' },
    });

    // Get work logs for this week
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + 1); // Monday
    startOfWeek.setHours(0, 0, 0, 0);

    const workLogs = await prisma.driverWorkLog.findMany({
      where: {
        date: { gte: startOfWeek },
      },
    });

    // Query separata per determinare lo stato ATTUALE (considera TUTTI i viaggi)
    const allCurrentTrips = await prisma.trip.findMany({
      where: {
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        departureTime: { lte: now },
      },
      include: {
        vehicle: { select: { plate: true } },
      },
    });

    const result = drivers.map(driver => {
      const driverTrips = trips.filter(t => t.driverId === driver.id);

      // Calculate hours from trips (estimate 8h per trip)
      const estimatedHours = driverTrips.reduce((sum, trip) => {
        const departure = new Date(trip.departureTime);
        const returnTime = trip.returnTime
          ? new Date(trip.returnTime)
          : new Date(departure.getTime() + 8 * 60 * 60 * 1000);
        return sum + (returnTime.getTime() - departure.getTime()) / (1000 * 60 * 60);
      }, 0);

      // Get actual work log hours for current week
      const weekLogs = workLogs.filter(l => l.driverId === driver.id);
      const actualWeeklyHours = weekLogs.reduce((sum, l) => sum + l.drivingHours, 0);

      // Calculate hours per day in period
      const hoursByDate = new Map<string, number>();
      driverTrips.forEach(trip => {
        const dateKey = new Date(trip.departureTime).toISOString().split('T')[0];
        const hours = trip.returnTime
          ? (new Date(trip.returnTime).getTime() - new Date(trip.departureTime).getTime()) / (1000 * 60 * 60)
          : 8;
        hoursByDate.set(dateKey, (hoursByDate.get(dateKey) || 0) + hours);
      });

      // Find days over limit
      const daysOverLimit: string[] = [];
      hoursByDate.forEach((hours, date) => {
        if (hours > MAX_DAILY_HOURS) {
          daysOverLimit.push(date);
        }
      });

      // Check if currently on a trip (considera TUTTI i viaggi, non solo quelli della pianificazione)
      const currentTrip = allCurrentTrips.find(t => {
        if (t.driverId !== driver.id) return false;
        const departure = new Date(t.departureTime);
        const returnTime = t.returnTime ? new Date(t.returnTime) : new Date(departure.getTime() + 8 * 60 * 60 * 1000);
        return t.status === 'IN_PROGRESS' || (departure <= now && returnTime > now);
      });

      return {
        id: driver.id,
        name: driver.name,
        type: driver.type,
        phone: driver.phone,
        hourlyCost: driver.hourlyCost,
        adrLicenseExpiry: driver.adrLicenseExpiry,
        adrCisternExpiry: driver.adrCisternExpiry,
        status: currentTrip ? 'DRIVING' : 'AVAILABLE',
        currentTrip: currentTrip ? {
          id: currentTrip.id,
          vehiclePlate: currentTrip.vehicle.plate,
          departureTime: currentTrip.departureTime,
          returnTime: currentTrip.returnTime,
        } : null,
        periodStats: {
          tripsCount: driverTrips.length,
          estimatedHours: Math.round(estimatedHours * 10) / 10,
        },
        weeklyStats: {
          hoursWorked: Math.round(actualWeeklyHours * 10) / 10,
          hoursRemaining: Math.max(0, MAX_WEEKLY_HOURS - actualWeeklyHours),
          percentUsed: Math.round((actualWeeklyHours / MAX_WEEKLY_HOURS) * 100),
        },
        daysOverLimit,
        trips: driverTrips.map(t => ({
          id: t.id,
          date: t.date,
          departureTime: t.departureTime,
          returnTime: t.returnTime,
          status: t.status,
          vehiclePlate: t.vehicle.plate,
          trailers: t.trailers.map(tt => ({
            plate: tt.trailer.plate,
            liters: tt.litersLoaded,
          })),
        })),
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}
