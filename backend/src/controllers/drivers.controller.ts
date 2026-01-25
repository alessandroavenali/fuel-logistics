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
