import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createRouteSchema, updateRouteSchema, calculateRouteSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';
import { calculateRouteFromCoordinates } from '../services/routing.service.js';

export async function getRoutes(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { isActive } = req.query;

    const routes = await prisma.route.findMany({
      where: isActive !== undefined ? { isActive: isActive === 'true' } : undefined,
      include: {
        fromLocation: true,
        toLocation: true,
      },
      orderBy: { name: 'asc' },
    });

    res.json(routes);
  } catch (error) {
    next(error);
  }
}

export async function getRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const route = await prisma.route.findUnique({
      where: { id },
      include: {
        fromLocation: true,
        toLocation: true,
      },
    });

    if (!route) {
      throw new AppError(404, 'Route not found');
    }

    res.json(route);
  } catch (error) {
    next(error);
  }
}

export async function createRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createRouteSchema.parse(req.body);

    // Verify locations exist
    const [fromLocation, toLocation] = await Promise.all([
      prisma.location.findUnique({ where: { id: data.fromLocationId } }),
      prisma.location.findUnique({ where: { id: data.toLocationId } }),
    ]);

    if (!fromLocation) {
      throw new AppError(404, 'From location not found');
    }
    if (!toLocation) {
      throw new AppError(404, 'To location not found');
    }

    const route = await prisma.route.create({
      data,
      include: {
        fromLocation: true,
        toLocation: true,
      },
    });

    res.status(201).json(route);
  } catch (error) {
    next(error);
  }
}

export async function updateRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateRouteSchema.parse(req.body);

    const route = await prisma.route.update({
      where: { id },
      data,
      include: {
        fromLocation: true,
        toLocation: true,
      },
    });

    res.json(route);
  } catch (error) {
    next(error);
  }
}

export async function deleteRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.route.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function calculateRoute(req: Request, res: Response, next: NextFunction) {
  try {
    const data = calculateRouteSchema.parse(req.body);

    const result = await calculateRouteFromCoordinates(
      data.fromCoordinates,
      data.toCoordinates
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
}
