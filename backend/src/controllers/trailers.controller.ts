import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createTrailerSchema, updateTrailerSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';

export async function getTrailers(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { isActive } = req.query;

    const trailers = await prisma.trailer.findMany({
      where: isActive !== undefined ? { isActive: isActive === 'true' } : undefined,
      orderBy: { createdAt: 'desc' },
    });

    res.json(trailers);
  } catch (error) {
    next(error);
  }
}

export async function getTrailer(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const trailer = await prisma.trailer.findUnique({
      where: { id },
      include: {
        tripTrailers: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            trip: true,
            dropOffLocation: true,
          },
        },
      },
    });

    if (!trailer) {
      throw new AppError(404, 'Trailer not found');
    }

    res.json(trailer);
  } catch (error) {
    next(error);
  }
}

export async function createTrailer(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createTrailerSchema.parse(req.body);

    const trailer = await prisma.trailer.create({
      data,
    });

    res.status(201).json(trailer);
  } catch (error) {
    next(error);
  }
}

export async function updateTrailer(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateTrailerSchema.parse(req.body);

    const trailer = await prisma.trailer.update({
      where: { id },
      data,
    });

    res.json(trailer);
  } catch (error) {
    next(error);
  }
}

export async function deleteTrailer(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.trailer.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function getTrailersAtLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { locationId } = req.params;

    // Find trailers that were dropped off at this location and not yet picked up
    const trailersAtLocation = await prisma.tripTrailer.findMany({
      where: {
        dropOffLocationId: locationId,
        isPickup: false,
        // Check that there's no subsequent pickup
        NOT: {
          trailer: {
            tripTrailers: {
              some: {
                isPickup: true,
                createdAt: {
                  gt: prisma.tripTrailer.fields.createdAt,
                },
              },
            },
          },
        },
      },
      include: {
        trailer: true,
        trip: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(trailersAtLocation);
  } catch (error) {
    next(error);
  }
}
