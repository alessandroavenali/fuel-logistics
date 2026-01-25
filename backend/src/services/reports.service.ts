import { PrismaClient } from '@prisma/client';

export interface ReportData {
  trips: any[];
  summary: any;
}

export async function getReportData(
  prisma: PrismaClient,
  fromDate: Date,
  toDate: Date
): Promise<ReportData> {
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
        },
      },
    },
    orderBy: { date: 'asc' },
  });

  const totalLiters = trips.reduce(
    (sum, trip) =>
      sum + trip.trailers.reduce((tSum, t) => tSum + t.litersLoaded, 0),
    0
  );

  const summary = {
    totalTrips: trips.length,
    totalLiters,
    completedTrips: trips.filter((t) => t.status === 'COMPLETED').length,
    plannedTrips: trips.filter((t) => t.status === 'PLANNED').length,
    inProgressTrips: trips.filter((t) => t.status === 'IN_PROGRESS').length,
    cancelledTrips: trips.filter((t) => t.status === 'CANCELLED').length,
  };

  return { trips, summary };
}
