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

    const status = await getTrailersStatusInternal(prisma);
    const trailersAtLocation = status.filter(t => t.currentLocationId === locationId);

    res.json(trailersAtLocation);
  } catch (error) {
    next(error);
  }
}

// Stato corrente di tutte le cisterne
export async function getTrailersStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { scheduleId } = req.query;

    const status = await getTrailersStatusInternal(prisma, scheduleId as string | undefined);
    res.json(status);
  } catch (error) {
    next(error);
  }
}

interface TrailerStatus {
  id: string;
  plate: string;
  name: string | null;
  capacityLiters: number;
  isActive: boolean;
  currentLocation: 'SOURCE' | 'PARKING' | 'IN_TRANSIT';
  currentLocationId: string | null;
  currentLocationName: string | null;
  lastTripId: string | null;
  lastTripDate: Date | null;
  availableFrom: Date | null;
}

async function getTrailersStatusInternal(
  prisma: PrismaClient,
  _scheduleId?: string // scheduleId non usato per lo stato attuale - serve per eventuali filtri futuri
): Promise<TrailerStatus[]> {
  // Get all active trailers
  const trailers = await prisma.trailer.findMany({
    where: { isActive: true },
    orderBy: { plate: 'asc' },
  });

  // Get source location (Milano)
  const sourceLocation = await prisma.location.findFirst({
    where: { type: 'SOURCE', isActive: true },
  });

  // Get all locations for reference
  const locations = await prisma.location.findMany({
    where: { isActive: true },
  });
  const locationMap = new Map(locations.map(l => [l.id, l]));

  const result: TrailerStatus[] = [];

  for (const trailer of trailers) {
    // IMPORTANT: Per determinare la posizione ATTUALE, dobbiamo considerare TUTTI i viaggi
    // non solo quelli di una specifica pianificazione
    const lastTripTrailer = await prisma.tripTrailer.findFirst({
      where: {
        trailerId: trailer.id,
        trip: {
          status: { in: ['COMPLETED', 'IN_PROGRESS', 'PLANNED'] },
        },
      },
      include: {
        trip: true,
        dropOffLocation: true,
      },
      orderBy: {
        trip: { departureTime: 'desc' },
      },
    });

    let currentLocation: 'SOURCE' | 'PARKING' | 'IN_TRANSIT' = 'SOURCE';
    let currentLocationId: string | null = sourceLocation?.id || null;
    let currentLocationName: string | null = sourceLocation?.name || 'Deposito';
    let availableFrom: Date | null = null;

    if (lastTripTrailer) {
      const trip = lastTripTrailer.trip;
      const now = new Date();

      // Check if trip is in progress
      if (trip.status === 'IN_PROGRESS' ||
          (trip.status === 'PLANNED' && new Date(trip.departureTime) <= now &&
           (!trip.returnTime || new Date(trip.returnTime) > now))) {
        currentLocation = 'IN_TRANSIT';
        currentLocationId = null;
        currentLocationName = 'In viaggio';
        availableFrom = trip.returnTime ? new Date(trip.returnTime) : null;
      }
      // Trip completed or planned in the future
      else if (trip.status === 'COMPLETED' ||
               (trip.status === 'PLANNED' && trip.returnTime && new Date(trip.returnTime) <= now)) {
        // Was it dropped off at parking?
        if (lastTripTrailer.dropOffLocationId && !lastTripTrailer.isPickup) {
          // Check if it was picked up later
          const subsequentPickup = await prisma.tripTrailer.findFirst({
            where: {
              trailerId: trailer.id,
              isPickup: true,
              trip: {
                departureTime: { gt: trip.departureTime },
                status: { in: ['COMPLETED', 'IN_PROGRESS'] },
              },
            },
          });

          if (!subsequentPickup) {
            // Still at parking location
            currentLocation = 'PARKING';
            currentLocationId = lastTripTrailer.dropOffLocationId;
            const loc = locationMap.get(lastTripTrailer.dropOffLocationId);
            currentLocationName = loc?.name || 'Parcheggio';
          }
        }
        // Otherwise it's back at source (default)
      }
      // Planned trip in the future - trailer is where it was before
      else if (trip.status === 'PLANNED' && new Date(trip.departureTime) > now) {
        // Find the previous completed trip to determine current location
        const prevTripTrailer = await prisma.tripTrailer.findFirst({
          where: {
            trailerId: trailer.id,
            trip: {
              status: 'COMPLETED',
              returnTime: { lt: trip.departureTime },
            },
          },
          include: {
            trip: true,
            dropOffLocation: true,
          },
          orderBy: {
            trip: { departureTime: 'desc' },
          },
        });

        if (prevTripTrailer?.dropOffLocationId && !prevTripTrailer.isPickup) {
          // Check if picked up
          const subsequentPickup = await prisma.tripTrailer.findFirst({
            where: {
              trailerId: trailer.id,
              isPickup: true,
              trip: {
                departureTime: { gt: prevTripTrailer.trip.departureTime },
                status: { in: ['COMPLETED'] },
              },
            },
          });

          if (!subsequentPickup) {
            currentLocation = 'PARKING';
            currentLocationId = prevTripTrailer.dropOffLocationId;
            const loc = locationMap.get(prevTripTrailer.dropOffLocationId);
            currentLocationName = loc?.name || 'Parcheggio';
          }
        }
      }
    }

    result.push({
      id: trailer.id,
      plate: trailer.plate,
      name: trailer.name,
      capacityLiters: trailer.capacityLiters,
      isActive: trailer.isActive,
      currentLocation,
      currentLocationId,
      currentLocationName,
      lastTripId: lastTripTrailer?.tripId || null,
      lastTripDate: lastTripTrailer?.trip.departureTime || null,
      availableFrom,
    });
  }

  return result;
}
