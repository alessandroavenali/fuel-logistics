import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Cleaning database...');

  // Delete in correct order (respecting foreign keys)
  await prisma.tripTrailer.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.scheduleInitialState.deleteMany();
  await prisma.schedule.deleteMany();
  await prisma.driverWorkLog.deleteMany();
  await prisma.route.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.trailer.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.location.deleteMany();
  await prisma.setting.deleteMany();

  console.log('Database cleaned. Seeding...');

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

  console.log('Created locations:', { milano: milano.name, tirano: tirano.name, livigno: livigno.name });

  // Create routes (tempi aggiornati: Tirano-Livigno 90min, Tirano-Milano 150min)
  await prisma.route.createMany({
    data: [
      {
        name: 'Milano -> Tirano',
        fromLocationId: milano.id,
        toLocationId: tirano.id,
        distanceKm: 150,
        durationMinutes: 150, // 2.5h
        tollCost: 15,
      },
      {
        name: 'Tirano -> Livigno',
        fromLocationId: tirano.id,
        toLocationId: livigno.id,
        distanceKm: 45,
        durationMinutes: 120, // 2h (salita, montagna)
        tollCost: 0,
      },
      {
        name: 'Livigno -> Tirano',
        fromLocationId: livigno.id,
        toLocationId: tirano.id,
        distanceKm: 45,
        durationMinutes: 90, // 1.5h (discesa)
        tollCost: 0,
      },
      {
        name: 'Tirano -> Milano',
        fromLocationId: tirano.id,
        toLocationId: milano.id,
        distanceKm: 150,
        durationMinutes: 150, // 2.5h
        tollCost: 15,
      },
    ],
  });

  console.log('Created 4 routes');

  // Create 4 vehicles (motrici con cisterna integrata 17,500L)
  // FG001AA base Livigno, altri base Tirano
  const vehicles = await Promise.all([
    prisma.vehicle.create({
      data: { plate: 'FG001AA', name: 'Motrice Alfa', maxTrailers: 2, baseLocationId: livigno.id },
    }),
    prisma.vehicle.create({
      data: { plate: 'FG002BB', name: 'Motrice Beta', maxTrailers: 2, baseLocationId: tirano.id },
    }),
    prisma.vehicle.create({
      data: { plate: 'FG003CC', name: 'Motrice Gamma', maxTrailers: 2, baseLocationId: tirano.id },
    }),
    prisma.vehicle.create({
      data: { plate: 'FG004DD', name: 'Motrice Delta', maxTrailers: 2, baseLocationId: tirano.id },
    }),
  ]);

  console.log('Created 4 vehicles:', vehicles.map(v => v.plate).join(', '));

  // Create 4 trailers (rimorchi) - 17,500L each, tutti base Tirano
  // Le motrici hanno già cisterna integrata da 17,500L, i rimorchi sono aggiuntivi
  const trailers = await Promise.all([
    prisma.trailer.create({ data: { plate: 'RIM-001', name: 'Rimorchio 1', capacityLiters: 17500, baseLocationId: tirano.id } }),
    prisma.trailer.create({ data: { plate: 'RIM-002', name: 'Rimorchio 2', capacityLiters: 17500, baseLocationId: tirano.id } }),
    prisma.trailer.create({ data: { plate: 'RIM-003', name: 'Rimorchio 3', capacityLiters: 17500, baseLocationId: tirano.id } }),
    prisma.trailer.create({ data: { plate: 'RIM-004', name: 'Rimorchio 4', capacityLiters: 17500, baseLocationId: tirano.id } }),
  ]);

  console.log('Created 4 trailers (17,500L each):', trailers.map(t => t.plate).join(', '));

  // Create 5 drivers con base operativa
  // Marco Bianchi -> base Livigno (unico driver di Livigno, max 3 shuttle/giorno)
  // Altri 4 -> base Tirano
  const oneYearFromNow = new Date();
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  const drivers = await Promise.all([
    // Marco Bianchi - base LIVIGNO (può fare max 3 shuttle/giorno)
    prisma.driver.create({
      data: {
        name: 'Marco Bianchi',
        type: 'RESIDENT',
        phone: '+39 333 1001001',
        adrLicenseExpiry: oneYearFromNow,
        adrCisternExpiry: oneYearFromNow,
        weeklyWorkingDays: 5,
        hourlyCost: 0,
        baseLocationId: livigno.id, // Base Livigno
      },
    }),
    // Luca Rossi - base TIRANO
    prisma.driver.create({
      data: {
        name: 'Luca Rossi',
        type: 'RESIDENT',
        phone: '+39 333 1002002',
        adrLicenseExpiry: oneYearFromNow,
        adrCisternExpiry: oneYearFromNow,
        weeklyWorkingDays: 5,
        hourlyCost: 0,
        baseLocationId: tirano.id, // Base Tirano
      },
    }),
    // Paolo Verdi - base TIRANO
    prisma.driver.create({
      data: {
        name: 'Paolo Verdi',
        type: 'RESIDENT',
        phone: '+39 333 1003003',
        adrLicenseExpiry: oneYearFromNow,
        adrCisternExpiry: oneYearFromNow,
        weeklyWorkingDays: 5,
        hourlyCost: 0,
        baseLocationId: tirano.id, // Base Tirano
      },
    }),
    // Giovanni Neri - base TIRANO (a chiamata)
    prisma.driver.create({
      data: {
        name: 'Giovanni Neri',
        type: 'ON_CALL',
        phone: '+39 333 2001001',
        adrLicenseExpiry: oneYearFromNow,
        adrCisternExpiry: oneYearFromNow,
        weeklyWorkingDays: 6,
        hourlyCost: 28,
        baseLocationId: tirano.id, // Base Tirano
      },
    }),
    // Andrea Gialli - base TIRANO (emergenze)
    prisma.driver.create({
      data: {
        name: 'Andrea Gialli',
        type: 'EMERGENCY',
        phone: '+39 333 3001001',
        adrLicenseExpiry: oneYearFromNow,
        adrCisternExpiry: oneYearFromNow,
        weeklyWorkingDays: 5,
        hourlyCost: 0,
        baseLocationId: tirano.id, // Base Tirano
      },
    }),
  ]);

  console.log('Created 5 drivers:');
  console.log('  - Marco Bianchi (RESIDENT) - Base: LIVIGNO');
  console.log('  - Luca Rossi (RESIDENT) - Base: TIRANO');
  console.log('  - Paolo Verdi (RESIDENT) - Base: TIRANO');
  console.log('  - Giovanni Neri (ON_CALL) - Base: TIRANO');
  console.log('  - Andrea Gialli (EMERGENCY) - Base: TIRANO');

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

  console.log('\n✅ Seeding completed successfully!');
  console.log('\nSummary:');
  console.log('  - 3 locations (Milano, Tirano, Livigno)');
  console.log('  - 4 routes:');
  console.log('      Tirano→Livigno: 120min (salita)');
  console.log('      Livigno→Tirano: 90min (discesa)');
  console.log('      Milano↔Tirano: 150min');
  console.log('  - 4 vehicles (motrici 17,500L): 1 Livigno, 3 Tirano');
  console.log('  - 4 trailers (rimorchi 17,500L): tutti Tirano');
  console.log('  - 5 drivers: 1 Livigno, 4 Tirano');
}

main()
  .catch((e) => {
    console.error('Error seeding database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
