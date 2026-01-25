import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { getReportData } from '../services/reports.service.js';

export async function getTripsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const toDate = to ? new Date(to as string) : new Date();

    const trips = await prisma.trip.findMany({
      where: {
        date: {
          gte: fromDate,
          lte: toDate,
        },
      },
      include: {
        vehicle: true,
        driver: true,
        schedule: true,
        trailers: {
          include: {
            trailer: true,
            dropOffLocation: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    const totalLiters = trips.reduce(
      (sum, trip) => sum + trip.trailers.reduce((tSum, t) => tSum + t.litersLoaded, 0),
      0
    );

    res.json({
      trips,
      summary: {
        totalTrips: trips.length,
        totalLiters,
        completedTrips: trips.filter((t) => t.status === 'COMPLETED').length,
        cancelledTrips: trips.filter((t) => t.status === 'CANCELLED').length,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getDriversReport(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const toDate = to ? new Date(to as string) : new Date();

    const drivers = await prisma.driver.findMany({
      where: { isActive: true },
      include: {
        trips: {
          where: {
            date: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
        workLogs: {
          where: {
            date: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
      },
    });

    const report = drivers.map((driver) => ({
      id: driver.id,
      name: driver.name,
      type: driver.type,
      totalTrips: driver.trips.length,
      totalDrivingHours: driver.workLogs.reduce((sum, log) => sum + log.drivingHours, 0),
      totalWorkingHours: driver.workLogs.reduce((sum, log) => sum + log.workingHours, 0),
      hourlyCost: driver.hourlyCost,
      estimatedCost: driver.hourlyCost
        ? driver.workLogs.reduce((sum, log) => sum + log.workingHours, 0) * driver.hourlyCost
        : null,
    }));

    res.json(report);
  } catch (error) {
    next(error);
  }
}

export async function getCostsReport(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const toDate = to ? new Date(to as string) : new Date();

    // Get on-call drivers' hours
    const onCallDrivers = await prisma.driver.findMany({
      where: {
        type: 'ON_CALL',
        isActive: true,
      },
      include: {
        workLogs: {
          where: {
            date: {
              gte: fromDate,
              lte: toDate,
            },
          },
        },
      },
    });

    const driverCosts = onCallDrivers.map((driver) => {
      const totalHours = driver.workLogs.reduce((sum, log) => sum + log.workingHours, 0);
      return {
        driverId: driver.id,
        driverName: driver.name,
        totalHours,
        hourlyCost: driver.hourlyCost || 0,
        totalCost: totalHours * (driver.hourlyCost || 0),
      };
    });

    // Get routes with toll costs
    const trips = await prisma.trip.findMany({
      where: {
        date: {
          gte: fromDate,
          lte: toDate,
        },
        status: { not: 'CANCELLED' },
      },
    });

    res.json({
      driverCosts,
      totalDriverCosts: driverCosts.reduce((sum, d) => sum + d.totalCost, 0),
      tripCount: trips.length,
    });
  } catch (error) {
    next(error);
  }
}

export async function getLitersReport(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const toDate = to ? new Date(to as string) : new Date();

    const trips = await prisma.trip.findMany({
      where: {
        date: {
          gte: fromDate,
          lte: toDate,
        },
        status: { in: ['COMPLETED', 'IN_PROGRESS', 'PLANNED'] },
      },
      include: {
        trailers: true,
      },
      orderBy: { date: 'asc' },
    });

    // Group by date
    const byDate = trips.reduce(
      (acc, trip) => {
        const dateKey = trip.date.toISOString().split('T')[0];
        if (!acc[dateKey]) {
          acc[dateKey] = { date: dateKey, liters: 0, trips: 0 };
        }
        acc[dateKey].liters += trip.trailers.reduce((sum, t) => sum + t.litersLoaded, 0);
        acc[dateKey].trips += 1;
        return acc;
      },
      {} as Record<string, { date: string; liters: number; trips: number }>
    );

    const totalLiters = Object.values(byDate).reduce((sum, d) => sum + d.liters, 0);

    res.json({
      daily: Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)),
      totalLiters,
      averageLitersPerDay: Object.keys(byDate).length > 0 ? totalLiters / Object.keys(byDate).length : 0,
    });
  } catch (error) {
    next(error);
  }
}

export async function getEfficiencyReport(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to } = req.query;

    const fromDate = from ? new Date(from as string) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const toDate = to ? new Date(to as string) : new Date();

    const schedules = await prisma.schedule.findMany({
      where: {
        startDate: {
          gte: fromDate,
        },
        endDate: {
          lte: toDate,
        },
      },
      include: {
        trips: {
          include: {
            trailers: true,
          },
        },
      },
    });

    const report = schedules.map((schedule) => {
      const deliveredLiters = schedule.trips
        .filter((t) => t.status === 'COMPLETED')
        .reduce((sum, trip) => sum + trip.trailers.reduce((tSum, t) => tSum + t.litersLoaded, 0), 0);

      return {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        requiredLiters: schedule.requiredLiters,
        deliveredLiters,
        efficiency: schedule.requiredLiters > 0 ? (deliveredLiters / schedule.requiredLiters) * 100 : 0,
        totalTrips: schedule.trips.length,
        completedTrips: schedule.trips.filter((t) => t.status === 'COMPLETED').length,
        status: schedule.status,
      };
    });

    res.json(report);
  } catch (error) {
    next(error);
  }
}
