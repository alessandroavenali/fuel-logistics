import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createVehicleSchema, updateVehicleSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getVehicles(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { isActive } = req.query;

    const vehicles = await prisma.vehicle.findMany({
      where: isActive !== undefined ? { isActive: isActive === 'true' } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    res.json(vehicles);
  } catch (error) {
    next(error);
  }
}

export async function getVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        trips: {
          take: 10,
          orderBy: { date: 'desc' },
        },
      },
    });

    if (!vehicle) {
      throw new AppError(404, 'Vehicle not found');
    }

    res.json(vehicle);
  } catch (error) {
    next(error);
  }
}

export async function createVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createVehicleSchema.parse(req.body);

    const vehicle = await prisma.vehicle.create({
      data,
    });

    res.status(201).json(vehicle);
  } catch (error) {
    next(error);
  }
}

export async function updateVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateVehicleSchema.parse(req.body);

    const vehicle = await prisma.vehicle.update({
      where: { id },
      data,
    });

    res.json(vehicle);
  } catch (error) {
    next(error);
  }
}

export async function deleteVehicle(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.vehicle.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
