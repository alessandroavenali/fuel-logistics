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

// Stato veicoli con impegni per un periodo
export async function getVehiclesStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { from, to, scheduleId } = req.query;

    const vehicles = await prisma.vehicle.findMany({
      where: { isActive: true },
      orderBy: { plate: 'asc' },
    });

    // Query per i viaggi della pianificazione specifica (per conteggio e lista)
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
        driver: { select: { id: true, name: true } },
        trailers: {
          include: {
            trailer: { select: { id: true, plate: true } },
          },
        },
      },
      orderBy: { departureTime: 'asc' },
    });

    // Query separata per determinare lo stato ATTUALE (considera TUTTI i viaggi)
    const now = new Date();
    const allCurrentTrips = await prisma.trip.findMany({
      where: {
        status: { in: ['PLANNED', 'IN_PROGRESS'] },
        departureTime: { lte: now },
      },
      include: {
        driver: { select: { id: true, name: true } },
      },
    });

    const result = vehicles.map(vehicle => {
      const vehicleTrips = trips.filter(t => t.vehicleId === vehicle.id);

      // Trova il viaggio attuale considerando TUTTI i viaggi (non solo quelli della pianificazione)
      const currentTrip = allCurrentTrips.find(t => {
        if (t.vehicleId !== vehicle.id) return false;
        const departure = new Date(t.departureTime);
        const returnTime = t.returnTime ? new Date(t.returnTime) : new Date(departure.getTime() + 8 * 60 * 60 * 1000);
        return t.status === 'IN_PROGRESS' || (departure <= now && returnTime > now);
      });

      return {
        id: vehicle.id,
        plate: vehicle.plate,
        name: vehicle.name,
        maxTrailers: vehicle.maxTrailers,
        isActive: vehicle.isActive,
        status: currentTrip ? 'IN_USE' : 'AVAILABLE',
        currentTrip: currentTrip ? {
          id: currentTrip.id,
          driverName: currentTrip.driver.name,
          departureTime: currentTrip.departureTime,
          returnTime: currentTrip.returnTime,
        } : null,
        tripsCount: vehicleTrips.length,
        trips: vehicleTrips.map(t => ({
          id: t.id,
          date: t.date,
          departureTime: t.departureTime,
          returnTime: t.returnTime,
          status: t.status,
          driverName: t.driver.name,
          trailers: t.trailers.map(tt => tt.trailer.plate),
        })),
      };
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
}
