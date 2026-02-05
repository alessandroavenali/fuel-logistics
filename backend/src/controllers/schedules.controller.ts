import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { createScheduleSchema, updateScheduleSchema, createTripSchema, updateTripSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';
import { optimizeSchedule, calculateMaxCapacity } from '../services/optimizer.service.js';
import { runCPSATOptimizer, calculateMaxCapacityCPSAT } from '../services/optimizer-cpsat.service.js';
import { validateTripsForSchedule } from '../services/adrValidator.service.js';

type MaxCalcJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';

interface MaxCalcJob {
  id: string;
  status: MaxCalcJobStatus;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  progressPath?: string;
  stopPath?: string;
}

interface OptimizeJob extends MaxCalcJob {
  scheduleId: string;
}

type JobProgress = {
  seq?: number;
  solutions?: number;
  objective_deliveries?: number;
  objective_liters?: number;
  elapsed_seconds?: number;
};

const maxCalcJobs = new Map<string, MaxCalcJob>();
const optimizeJobs = new Map<string, OptimizeJob>();
const MAX_JOB_RETENTION_MS = 60 * 60 * 1000; // 1h

async function validateDriverAvailabilityInput(
  prisma: PrismaClient,
  driverAvailability?: any[]
): Promise<{ ok: boolean; error?: string }> {
  if (!driverAvailability) return { ok: true };
  if (!Array.isArray(driverAvailability)) {
    return { ok: false, error: 'driverAvailability must be an array' };
  }
  if (driverAvailability.length === 0) {
    return { ok: false, error: 'driverAvailability is empty' };
  }
  const ids = driverAvailability.map(a => a.driverId).filter(Boolean);
  if (ids.length === 0) {
    return { ok: false, error: 'driverAvailability has no driverId entries' };
  }
  const count = await prisma.driver.count({
    where: { id: { in: ids }, isActive: true },
  });
  if (count === 0) {
    return { ok: false, error: 'driverAvailability has no valid driverId entries' };
  }
  return { ok: true };
}

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
    const optimizer = (req.query.optimizer as string) || 'cpsat';

    console.log('[calculateMax] Request:', {
      startDate,
      endDate,
      initialStates: initialStates?.length,
      vehicleStates: vehicleStates?.length,
      driverAvailability: driverAvailability?.length,
      includeWeekend,
      optimizer,
    });

    if (!startDate || !endDate) {
      throw new AppError(400, 'startDate and endDate are required');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError(400, 'startDate or endDate is invalid');
    }
    if (end < start) {
      throw new AppError(400, 'endDate must be on or after startDate');
    }
    if (driverAvailability) {
      const validation = await validateDriverAvailabilityInput(prisma, driverAvailability);
      if (!validation.ok) {
        throw new AppError(400, validation.error || 'Invalid driverAvailability');
      }
    }

    const input = {
      startDate,
      endDate,
      initialStates,
      vehicleStates,
      driverAvailability,
      includeWeekend,
    };

    // Use CP-SAT optimizer by default, fall back to legacy if specified
    const result = optimizer === 'legacy'
      ? await calculateMaxCapacity(prisma, input)
      : await calculateMaxCapacityCPSAT(prisma, input);

    console.log('[calculateMax] Result:', result);
    res.json(result);
  } catch (error) {
    console.error('[calculateMax] Error:', error);
    next(error);
  }
}

function cleanupMaxCalcJobs(now: number = Date.now()) {
  for (const [jobId, job] of maxCalcJobs.entries()) {
    const finishedAt = job.completedAt ?? job.createdAt;
    if (now - finishedAt > MAX_JOB_RETENTION_MS) {
      if (job.progressPath) {
        fs.promises.unlink(job.progressPath).catch(() => undefined);
      }
      if (job.stopPath) {
        fs.promises.unlink(job.stopPath).catch(() => undefined);
      }
      maxCalcJobs.delete(jobId);
    }
  }
  for (const [jobId, job] of optimizeJobs.entries()) {
    const finishedAt = job.completedAt ?? job.createdAt;
    if (now - finishedAt > MAX_JOB_RETENTION_MS) {
      if (job.progressPath) {
        fs.promises.unlink(job.progressPath).catch(() => undefined);
      }
      if (job.stopPath) {
        fs.promises.unlink(job.stopPath).catch(() => undefined);
      }
      optimizeJobs.delete(jobId);
    }
  }
}

async function readJobProgress(progressPath?: string): Promise<JobProgress | null> {
  if (!progressPath) return null;
  try {
    const content = await fs.promises.readFile(progressPath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length === 0) return null;
    const lastLine = lines[lines.length - 1];
    return JSON.parse(lastLine) as JobProgress;
  } catch {
    return null;
  }
}

async function readJobProgressHistory(progressPath?: string): Promise<(JobProgress & {
  delta_liters?: number;
  delta_seconds?: number;
  objective_bound_liters?: number;
  objective_bound_deliveries?: number;
})[] | null> {
  if (!progressPath) return null;
  try {
    const content = await fs.promises.readFile(progressPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    const history = lines
      .map(line => {
        try {
          return JSON.parse(line) as JobProgress;
        } catch {
          return null;
        }
      })
      .filter((item): item is JobProgress => !!item);
    if (history.length === 0) return null;
    let prevLiters: number | null = null;
    let prevSeconds: number | null = null;
    return history.map(entry => {
      const liters = typeof entry.objective_liters === 'number' ? entry.objective_liters : null;
      const seconds = typeof entry.elapsed_seconds === 'number' ? entry.elapsed_seconds : null;
      const delta_liters = liters !== null && prevLiters !== null ? liters - prevLiters : undefined;
      const delta_seconds = seconds !== null && prevSeconds !== null ? seconds - prevSeconds : undefined;
      if (liters !== null) prevLiters = liters;
      if (seconds !== null) prevSeconds = seconds;
      return {
        ...entry,
        delta_liters,
        delta_seconds,
      };
    });
  } catch {
    return null;
  }
}

function summarizeProgressHistory(history?: (JobProgress & {
  delta_liters?: number;
  delta_seconds?: number;
  objective_bound_liters?: number;
  objective_bound_deliveries?: number;
})[] | null) {
  if (!history || history.length === 0) return null;
  const improvements = history.filter(h => typeof h.delta_liters === 'number' && h.delta_liters > 0);
  const last = history[history.length - 1];
  const lastImprovement = improvements.length > 0 ? improvements[improvements.length - 1] : null;
  const lastImprovementSeconds = lastImprovement?.elapsed_seconds ?? null;
  const lastSeconds = typeof last.elapsed_seconds === 'number' ? last.elapsed_seconds : null;
  const lastBoundLiters = typeof last.objective_bound_liters === 'number' ? last.objective_bound_liters : null;
  const lastObjectiveLiters = typeof last.objective_liters === 'number' ? last.objective_liters : null;
  let gapPercent: number | null = null;
  if (lastBoundLiters !== null && lastObjectiveLiters !== null && lastBoundLiters > 0) {
    gapPercent = ((lastBoundLiters - lastObjectiveLiters) / lastBoundLiters) * 100;
  }
  const timeSinceLastImprovement =
    lastSeconds !== null && lastImprovementSeconds !== null
      ? Math.max(0, lastSeconds - lastImprovementSeconds)
      : null;
  const lastDeltaLiters = lastImprovement?.delta_liters ?? null;

  const windowSize = 5;
  const recent = improvements.slice(-windowSize);
  let avgDeltaLitersPerMinute: number | null = null;
  if (recent.length >= 2) {
    const first = recent[0];
    const lastRecent = recent[recent.length - 1];
    if (typeof first.elapsed_seconds === 'number' && typeof lastRecent.elapsed_seconds === 'number') {
      const dt = lastRecent.elapsed_seconds - first.elapsed_seconds;
      const dl = recent.reduce((sum, item) => sum + (item.delta_liters ?? 0), 0);
      if (dt > 0) {
        avgDeltaLitersPerMinute = (dl / dt) * 60;
      }
    }
  }

  return {
    totalSolutions: history.length,
    totalImprovements: improvements.length,
    lastObjectiveLiters,
    lastObjectiveBoundLiters: lastBoundLiters,
    gapPercent,
    lastElapsedSeconds: lastSeconds,
    lastImprovementSeconds,
    timeSinceLastImprovementSeconds: timeSinceLastImprovement,
    lastImprovementDeltaLiters: lastDeltaLiters,
    avgDeltaLitersPerMinuteRecent: avgDeltaLitersPerMinute,
    recentWindowSize: windowSize,
  };
}

export async function startCalculateMaxCapacityJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const {
      startDate,
      endDate,
      initialStates,
      vehicleStates,
      driverAvailability,
      includeWeekend,
      timeLimitSeconds,
      numSearchWorkers,
    } = req.body;
    const optimizer = (req.query.optimizer as string) || 'cpsat';

    if (!startDate || !endDate) {
      throw new AppError(400, 'startDate and endDate are required');
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new AppError(400, 'startDate or endDate is invalid');
    }
    if (end < start) {
      throw new AppError(400, 'endDate must be on or after startDate');
    }
    if (driverAvailability) {
      const validation = await validateDriverAvailabilityInput(prisma, driverAvailability);
      if (!validation.ok) {
        throw new AppError(400, validation.error || 'Invalid driverAvailability');
      }
    }

    cleanupMaxCalcJobs();

    const jobId = randomUUID();
    const progressPath = path.join('/tmp', `fuel-max-progress-${jobId}.jsonl`);
    const stopPath = path.join('/tmp', `fuel-max-stop-${jobId}.flag`);
    const job: MaxCalcJob = {
      id: jobId,
      status: 'PENDING',
      createdAt: Date.now(),
      progressPath,
      stopPath,
    };
    maxCalcJobs.set(jobId, job);

    const input = {
      startDate,
      endDate,
      initialStates,
      vehicleStates,
      driverAvailability,
      includeWeekend,
      timeLimitSeconds,
      numSearchWorkers,
      progressPath,
      stopPath,
    };

    void (async () => {
      const existing = maxCalcJobs.get(jobId);
      if (!existing) return;
      existing.status = 'RUNNING';
      existing.startedAt = Date.now();
      try {
        const result = optimizer === 'legacy'
          ? await calculateMaxCapacity(prisma, input)
          : await calculateMaxCapacityCPSAT(prisma, input);
        existing.status = 'COMPLETED';
        existing.result = result;
        existing.completedAt = Date.now();
      } catch (error) {
        existing.status = 'FAILED';
        existing.error = error instanceof Error ? error.message : String(error);
        existing.completedAt = Date.now();
      }
    })();

    res.status(202).json({
      jobId,
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function getCalculateMaxCapacityJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    cleanupMaxCalcJobs();

    const { jobId } = req.params;
    const includeProgress = req.query.includeProgress === '1';
    const job = maxCalcJobs.get(jobId);
    if (!job) {
      throw new AppError(404, 'Max-capacity job not found');
    }

    const now = Date.now();
    const elapsedMs = (job.startedAt ? now - job.startedAt : now - job.createdAt);

    const progress = await readJobProgress(job.progressPath);
    const progressHistory = includeProgress ? await readJobProgressHistory(job.progressPath) : null;
    const progressSummary = includeProgress ? summarizeProgressHistory(progressHistory) : null;

    res.json({
      jobId: job.id,
      status: job.status,
      elapsedMs,
      createdAt: new Date(job.createdAt).toISOString(),
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
      result: job.status === 'COMPLETED' ? job.result : undefined,
      error: job.status === 'FAILED' ? job.error : undefined,
      progress: progress ?? undefined,
      progressHistory: progressHistory ?? undefined,
      progressSummary: progressSummary ?? undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function stopCalculateMaxCapacityJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    cleanupMaxCalcJobs();

    const { jobId } = req.params;
    const job = maxCalcJobs.get(jobId);
    if (!job) {
      throw new AppError(404, 'Max-capacity job not found');
    }

    if (job.stopPath) {
      await fs.promises.writeFile(job.stopPath, 'stop');
    }

    res.status(202).json({ jobId, status: job.status });
  } catch (error) {
    next(error);
  }
}

export async function startOptimizeScheduleJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const { driverAvailability, timeLimitSeconds, numSearchWorkers } = req.body || {};
    const optimizer = (req.query.optimizer as string) || 'cpsat';

    cleanupMaxCalcJobs();

    if (driverAvailability) {
      const validation = await validateDriverAvailabilityInput(prisma, driverAvailability);
      if (!validation.ok) {
        throw new AppError(400, validation.error || 'Invalid driverAvailability');
      }
    }

    const jobId = randomUUID();
    const progressPath = path.join('/tmp', `fuel-opt-progress-${jobId}.jsonl`);
    const stopPath = path.join('/tmp', `fuel-opt-stop-${jobId}.flag`);

    const job: OptimizeJob = {
      id: jobId,
      scheduleId: id,
      status: 'PENDING',
      createdAt: Date.now(),
      progressPath,
      stopPath,
    };
    optimizeJobs.set(jobId, job);

    void (async () => {
      const existing = optimizeJobs.get(jobId);
      if (!existing) return;
      existing.status = 'RUNNING';
      existing.startedAt = Date.now();
      try {
        const result = optimizer === 'legacy'
          ? await optimizeSchedule(prisma, id, driverAvailability)
          : await runCPSATOptimizer(prisma, id, driverAvailability, {
              persist: true,
              timeLimitSeconds,
              numSearchWorkers,
              progressPath,
              stopPath,
            });
        existing.status = 'COMPLETED';
        existing.result = result;
        existing.completedAt = Date.now();
      } catch (error) {
        existing.status = 'FAILED';
        existing.error = error instanceof Error ? error.message : String(error);
        existing.completedAt = Date.now();
      }
    })();

    res.status(202).json({
      jobId,
      status: job.status,
      createdAt: new Date(job.createdAt).toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

export async function getOptimizeScheduleJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    cleanupMaxCalcJobs();

    const { jobId } = req.params;
    const includeProgress = req.query.includeProgress === '1';
    const job = optimizeJobs.get(jobId);
    if (!job) {
      throw new AppError(404, 'Optimize job not found');
    }

    const now = Date.now();
    const elapsedMs = (job.startedAt ? now - job.startedAt : now - job.createdAt);
    const progress = await readJobProgress(job.progressPath);
    const progressHistory = includeProgress ? await readJobProgressHistory(job.progressPath) : null;
    const progressSummary = includeProgress ? summarizeProgressHistory(progressHistory) : null;

    res.json({
      jobId: job.id,
      scheduleId: job.scheduleId,
      status: job.status,
      elapsedMs,
      createdAt: new Date(job.createdAt).toISOString(),
      startedAt: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
      completedAt: job.completedAt ? new Date(job.completedAt).toISOString() : undefined,
      result: job.status === 'COMPLETED' ? job.result : undefined,
      error: job.status === 'FAILED' ? job.error : undefined,
      progress: progress ?? undefined,
      progressHistory: progressHistory ?? undefined,
      progressSummary: progressSummary ?? undefined,
    });
  } catch (error) {
    next(error);
  }
}

export async function stopOptimizeScheduleJobHandler(req: Request, res: Response, next: NextFunction) {
  try {
    cleanupMaxCalcJobs();

    const { jobId } = req.params;
    const job = optimizeJobs.get(jobId);
    if (!job) {
      throw new AppError(404, 'Optimize job not found');
    }

    if (job.stopPath) {
      await fs.promises.writeFile(job.stopPath, 'stop');
    }

    res.status(202).json({ jobId, status: job.status });
  } catch (error) {
    next(error);
  }
}

export async function optimizeScheduleHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const { driverAvailability } = req.body;
    const optimizer = (req.query.optimizer as string) || 'cpsat';

    console.log('[optimize] Schedule:', id, 'DriverAvailability:', driverAvailability?.length || 0, 'Optimizer:', optimizer);

    // Use CP-SAT optimizer by default, fall back to legacy if specified
    const result = optimizer === 'legacy'
      ? await optimizeSchedule(prisma, id, driverAvailability)
      : await runCPSATOptimizer(prisma, id, driverAvailability);

    res.json(result);
  } catch (error) {
    next(error);
  }
}

export async function optimizerSelfCheckHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const prisma: PrismaClient = (req as any).prisma;
    const { id } = req.params;
    const { driverAvailability } = req.body || {};

    const schedule = await prisma.schedule.findUnique({
      where: { id },
      include: {
        trips: true,
      },
    });

    if (!schedule) {
      throw new AppError(404, 'Schedule not found');
    }

    const litersByType: Record<string, number> = {
      SHUTTLE_LIVIGNO: 17500,
      SHUTTLE_FROM_LIVIGNO: 17500,
      SUPPLY_FROM_LIVIGNO: 17500,
      SUPPLY_MILANO: 0,
      TRANSFER_TIRANO: 0,
      FULL_ROUND: 17500,
    };

    const persistedLiters = schedule.trips.reduce(
      (sum, t) => sum + (litersByType[t.tripType] ?? 0),
      0
    );

    const dryRun = await runCPSATOptimizer(
      prisma,
      id,
      driverAvailability,
      { persist: false }
    );

    const plannedLiters = dryRun.statistics.totalLiters;
    const solverObjectiveLiters = dryRun.solverObjectiveLiters ?? plannedLiters;
    const mismatch = persistedLiters !== solverObjectiveLiters;

    res.json({
      scheduleId: id,
      persistedTrips: schedule.trips.length,
      persistedLiters,
      plannedTrips: dryRun.statistics.totalTrips,
      plannedLiters,
      solverObjectiveLiters,
      solverStatus: dryRun.solverStatus,
      mismatch,
      warnings: [
        ...dryRun.warnings,
        ...(mismatch
          ? [`Mismatch detected: persisted=${persistedLiters}L vs solver=${solverObjectiveLiters}L`]
          : []),
      ],
    });
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
