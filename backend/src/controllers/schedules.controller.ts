import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createScheduleSchema, updateScheduleSchema, createTripSchema, updateTripSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';
import { optimizeSchedule, calculateMaxCapacity } from '../services/optimizer.service.js';
import { validateTripsForSchedule } from '../services/adrValidator.service.js';

export async function getSchedules(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { status } = req.query;

    const schedules = await prisma.schedule.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        _count: {
          select: { trips: true },
        },
      },
      orderBy: { startDate: 'desc' },
    });

    res.json(schedules);
  } catch (error) {
    next(error);
  }
}

export async function getSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const schedule = await prisma.schedule.findUnique({
      where: { id },
      include: {
        trips: {
          include: {
            vehicle: true,
            driver: true,
            trailers: {
              include: {
                trailer: true,
                dropOffLocation: true,
              },
            },
          },
          orderBy: { date: 'asc' },
        },
        initialStates: {
          include: {
            trailer: true,
            location: true,
          },
        },
        vehicleStates: {
          include: {
            vehicle: true,
            location: true,
          },
        },
      },
    });

    if (!schedule) {
      throw new AppError(404, 'Schedule not found');
    }

    res.json(schedule);
  } catch (error) {
    next(error);
  }
}

export async function createSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const data = createScheduleSchema.parse(req.body);

    const { initialStates, vehicleStates, ...scheduleData } = data;

    const schedule = await prisma.schedule.create({
      data: {
        ...scheduleData,
        startDate: new Date(scheduleData.startDate),
        endDate: new Date(scheduleData.endDate),
        initialStates: initialStates
          ? {
              create: initialStates.map((state) => ({
                trailerId: state.trailerId,
                locationId: state.locationId,
                isFull: state.isFull,
              })),
            }
          : undefined,
        vehicleStates: vehicleStates
          ? {
              create: vehicleStates.map((state) => ({
                vehicleId: state.vehicleId,
                locationId: state.locationId,
                isTankFull: state.isTankFull ?? false,
              })),
            }
          : undefined,
      },
      include: {
        initialStates: {
          include: {
            trailer: true,
            location: true,
          },
        },
        vehicleStates: {
          include: {
            vehicle: true,
            location: true,
          },
        },
      },
    });

    res.status(201).json(schedule);
  } catch (error) {
    next(error);
  }
}

export async function updateSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const data = updateScheduleSchema.parse(req.body);

    const { initialStates, vehicleStates, ...scheduleData } = data;

    const schedule = await prisma.$transaction(async (tx) => {
      // Update schedule
      const updatedSchedule = await tx.schedule.update({
        where: { id },
        data: {
          ...scheduleData,
          startDate: scheduleData.startDate ? new Date(scheduleData.startDate) : undefined,
          endDate: scheduleData.endDate ? new Date(scheduleData.endDate) : undefined,
        },
      });

      // Update initial states if provided
      if (initialStates) {
        // Delete existing initial states
        await tx.scheduleInitialState.deleteMany({
          where: { scheduleId: id },
        });

        // Create new initial states
        if (initialStates.length > 0) {
          await tx.scheduleInitialState.createMany({
            data: initialStates.map((state) => ({
              scheduleId: id,
              trailerId: state.trailerId,
              locationId: state.locationId,
              isFull: state.isFull,
            })),
          });
        }
      }

      // Update vehicle states if provided
      if (vehicleStates) {
        // Delete existing vehicle states
        await tx.scheduleVehicleState.deleteMany({
          where: { scheduleId: id },
        });

        // Create new vehicle states
        if (vehicleStates.length > 0) {
          await tx.scheduleVehicleState.createMany({
            data: vehicleStates.map((state) => ({
              scheduleId: id,
              vehicleId: state.vehicleId,
              locationId: state.locationId,
              isTankFull: state.isTankFull ?? false,
            })),
          });
        }
      }

      return updatedSchedule;
    });

    // Fetch complete schedule with relations
    const completeSchedule = await prisma.schedule.findUnique({
      where: { id },
      include: {
        initialStates: {
          include: {
            trailer: true,
            location: true,
          },
        },
        vehicleStates: {
          include: {
            vehicle: true,
            location: true,
          },
        },
      },
    });

    res.json(completeSchedule);
  } catch (error) {
    next(error);
  }
}

export async function deleteSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    await prisma.schedule.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export async function calculateMaxCapacityHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { startDate, endDate, initialStates, vehicleStates, driverAvailability, includeWeekend } = req.body;

    console.log('[calculateMax] Request:', {
      startDate,
      endDate,
      initialStates: initialStates?.length,
      vehicleStates: vehicleStates?.length,
      driverAvailability: driverAvailability?.length,
      includeWeekend,
    });

    if (!startDate || !endDate) {
      throw new AppError(400, 'startDate and endDate are required');
    }

    const result = await calculateMaxCapacity(prisma, {
      startDate,
      endDate,
      initialStates,
      vehicleStates,
      driverAvailability,
      includeWeekend,
    });

    console.log('[calculateMax] Result:', result);
    res.json(result);
  } catch (error) {
    console.error('[calculateMax] Error:', error);
    next(error);
  }
}

export async function optimizeScheduleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const { driverAvailability } = req.body;

    console.log('[optimize] Schedule:', id, 'DriverAvailability:', driverAvailability?.length || 0);

    const result = await optimizeSchedule(prisma, id, driverAvailability);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function confirmSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const schedule = await prisma.schedule.findUnique({
      where: { id },
      include: { trips: true },
    });

    if (!schedule) {
      throw new AppError(404, 'Schedule not found');
    }

    if (schedule.trips.length === 0) {
      throw new AppError(400, 'Cannot confirm schedule without trips');
    }

    const updated = await prisma.schedule.update({
      where: { id },
      data: { status: 'CONFIRMED' },
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
}

export async function validateSchedule(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const result = await validateTripsForSchedule(prisma, id);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

// Trip management within schedules
export async function getScheduleTrips(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;

    const trips = await prisma.trip.findMany({
      where: { scheduleId: id },
      include: {
        vehicle: true,
        driver: true,
        trailers: {
          include: {
            trailer: true,
            dropOffLocation: true,
          },
        },
      },
      orderBy: { date: 'asc' },
    });

    res.json(trips);
  } catch (error) {
    next(error);
  }
}

export async function createTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id: scheduleId } = req.params;
    const data = createTripSchema.parse({ ...req.body, scheduleId });

    const { trailers, ...tripData } = data;

    const trip = await prisma.trip.create({
      data: {
        ...tripData,
        date: new Date(tripData.date),
        departureTime: new Date(tripData.departureTime),
        returnTime: tripData.returnTime ? new Date(tripData.returnTime) : undefined,
        trailers: trailers
          ? {
              create: trailers.map((t) => ({
                trailerId: t.trailerId,
                litersLoaded: t.litersLoaded,
                dropOffLocationId: t.dropOffLocationId,
                isPickup: t.isPickup || false,
              })),
            }
          : undefined,
      },
      include: {
        vehicle: true,
        driver: true,
        trailers: {
          include: {
            trailer: true,
            dropOffLocation: true,
          },
        },
      },
    });

    res.status(201).json(trip);
  } catch (error) {
    next(error);
  }
}

export async function updateTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { tripId } = req.params;
    const data = updateTripSchema.parse(req.body);

    const { trailers, ...tripData } = data;

    // Update trip and trailers in transaction
    const trip = await prisma.$transaction(async (tx) => {
      // Update trip
      const updatedTrip = await tx.trip.update({
        where: { id: tripId },
        data: {
          ...tripData,
          date: tripData.date ? new Date(tripData.date) : undefined,
          departureTime: tripData.departureTime ? new Date(tripData.departureTime) : undefined,
          returnTime: tripData.returnTime ? new Date(tripData.returnTime) : undefined,
        },
      });

      // Update trailers if provided
      if (trailers) {
        // Delete existing trailers
        await tx.tripTrailer.deleteMany({
          where: { tripId },
        });

        // Create new trailers
        await tx.tripTrailer.createMany({
          data: trailers.map((t) => ({
            tripId,
            trailerId: t.trailerId,
            litersLoaded: t.litersLoaded,
            dropOffLocationId: t.dropOffLocationId,
            isPickup: t.isPickup || false,
          })),
        });
      }

      return updatedTrip;
    });

    // Fetch complete trip with relations
    const completeTrip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        vehicle: true,
        driver: true,
        trailers: {
          include: {
            trailer: true,
            dropOffLocation: true,
          },
        },
      },
    });

    res.json(completeTrip);
  } catch (error) {
    next(error);
  }
}

export async function deleteTrip(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { tripId } = req.params;

    await prisma.trip.delete({
      where: { id: tripId },
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
