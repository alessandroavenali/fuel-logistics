import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createLocationSchema, updateLocationSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getLocations(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { isActive, type } = req.query;

    const locations = await prisma.location.findMany({
      where: {
        ...(isActive !== undefined && { isActive: isActive === 'true' }),
        ...(type && { type: type as any }),
      },
      orderBy: { name: 'asc' },
    });

    res.json(locations);
  } catch (error) {
    next(error);
  }
}

export async function getLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const location = await prisma.location.findUnique({
      where: { id },
      include: {
        routesFrom: {
          include: { toLocation: true },
        },
        routesTo: {
          include: { fromLocation: true },
        },
      },
    });

    if (!location) {
      throw new AppError(404, 'Location not found');
    }

    res.json(location);
  } catch (error) {
    next(error);
  }
}

export async function createLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createLocationSchema.parse(req.body);

    const location = await prisma.location.create({
      data,
    });

    res.status(201).json(location);
  } catch (error) {
    next(error);
  }
}

export async function updateLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateLocationSchema.parse(req.body);

    const location = await prisma.location.update({
      where: { id },
      data,
    });

    res.json(location);
  } catch (error) {
    next(error);
  }
}

export async function deleteLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.location.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
