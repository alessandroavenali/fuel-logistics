import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Create locations
  const milano = await prisma.location.create({
    data: {
      name: 'Milano Deposito',
      type: 'SOURCE',
      address: 'Via Carburanti 1, 20100 Milano MI',
      latitude: 45.4642,
      longitude: 9.19,
    },
  });

  const tirano = await prisma.location.create({
    data: {
      name: 'Tirano Parcheggio',
      type: 'PARKING',
      address: 'Piazzale Stazione, 23037 Tirano SO',
      latitude: 46.2167,
      longitude: 10.1667,
    },
  });

  const livigno = await prisma.location.create({
    data: {
      name: 'Livigno Distributore',
      type: 'DESTINATION',
      address: 'Via Saroch 100, 23030 Livigno SO',
      latitude: 46.5389,
      longitude: 10.1353,
    },
  });

  console.log('Created locations:', { milano, tirano, livigno });

  // Create routes
  const milanoTirano = await prisma.route.create({
    data: {
      name: 'Milano -> Tirano',
      fromLocationId: milano.id,
      toLocationId: tirano.id,
      distanceKm: 150,
      durationMinutes: 150,
      tollCost: 15,
    },
  });

  const tiranoLivigno = await prisma.route.create({
    data: {
      name: 'Tirano -> Livigno',
      fromLocationId: tirano.id,
      toLocationId: livigno.id,
      distanceKm: 45,
      durationMinutes: 45,
      tollCost: 0,
    },
  });

  const livignoTirano = await prisma.route.create({
    data: {
      name: 'Livigno -> Tirano',
      fromLocationId: livigno.id,
      toLocationId: tirano.id,
      distanceKm: 45,
      durationMinutes: 45,
      tollCost: 0,
    },
  });

  const tiranoMilano = await prisma.route.create({
    data: {
      name: 'Tirano -> Milano',
      fromLocationId: tirano.id,
      toLocationId: milano.id,
      distanceKm: 150,
      durationMinutes: 150,
      tollCost: 15,
    },
  });

  console.log('Created routes');

  // Create a vehicle
  const vehicle1 = await prisma.vehicle.create({
    data: {
      plate: 'AA123BB',
      name: 'Motrice 1',
      maxTrailers: 2,
    },
  });

  const vehicle2 = await prisma.vehicle.create({
    data: {
      plate: 'CC456DD',
      name: 'Motrice 2',
      maxTrailers: 2,
    },
  });

  console.log('Created vehicles:', { vehicle1, vehicle2 });

  // Create trailers
  const trailer1 = await prisma.trailer.create({
    data: {
      plate: 'TR001',
      name: 'Cisterna 1',
      capacityLiters: 17500,
    },
  });

  const trailer2 = await prisma.trailer.create({
    data: {
      plate: 'TR002',
      name: 'Cisterna 2',
      capacityLiters: 17500,
    },
  });

  const trailer3 = await prisma.trailer.create({
    data: {
      plate: 'TR003',
      name: 'Cisterna 3',
      capacityLiters: 17500,
    },
  });

  console.log('Created trailers:', { trailer1, trailer2, trailer3 });

  // Create drivers
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const driver1 = await prisma.driver.create({
    data: {
      name: 'Mario Rossi',
      type: 'RESIDENT',
      phone: '+39 333 1234567',
      adrLicenseExpiry: oneYearFromNow,
      adrCisternExpiry: oneYearFromNow,
      weeklyWorkingDays: 5,
    },
  });

  const driver2 = await prisma.driver.create({
    data: {
      name: 'Giuseppe Verdi',
      type: 'ON_CALL',
      phone: '+39 333 7654321',
      adrLicenseExpiry: oneYearFromNow,
      adrCisternExpiry: oneYearFromNow,
      weeklyWorkingDays: 5,
      hourlyCost: 25,
    },
  });

  const driver3 = await prisma.driver.create({
    data: {
      name: 'Luigi Bianchi',
      type: 'RESIDENT',
      phone: '+39 333 9876543',
      adrLicenseExpiry: oneYearFromNow,
      adrCisternExpiry: oneYearFromNow,
      weeklyWorkingDays: 5,
    },
  });

  console.log('Created drivers:', { driver1, driver2, driver3 });

  // Create default settings
  await prisma.setting.createMany({
    data: [
      {
        key: 'DEFAULT_TRAILER_CAPACITY',
        value: '17500',
        description: 'Default trailer capacity in liters',
      },
      {
        key: 'DEFAULT_DEPARTURE_HOUR',
        value: '6',
        description: 'Default departure hour (24h format)',
      },
      {
        key: 'ESTIMATED_TRIP_DURATION',
        value: '8',
        description: 'Estimated full trip duration in hours',
      },
    ],
  });

  console.log('Created settings');

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
