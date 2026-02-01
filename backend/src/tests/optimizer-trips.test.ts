/**
 * Test Generazione Trip con optimizeSchedule
 *
 * Verifica che i trip generati rispettino la logica:
 * - Driver in eccesso → SUPPLY
 * - Timing corretto (SUPPLY inizia quando rimorchio diventa vuoto)
 * - Warning generati correttamente
 */

import { PrismaClient } from '@prisma/client';
import { optimizeSchedule, DriverAvailabilityInput } from '../services/optimizer.service.js';

const prisma = new PrismaClient();

interface TripSummary {
  driverName: string;
  tripType: string;
  departureTime: string;
  returnTime: string;
  liters: number;
}

async function runTripGenerationTest() {
  console.log('\n' + '#'.repeat(70));
  console.log('# TEST GENERAZIONE TRIP CON optimizeSchedule');
  console.log('#'.repeat(70));

  // Setup: crea uno schedule di test
  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });

  if (!tiranoLocation || !livignoLocation) {
    console.log('❌ Missing locations');
    return;
  }

  console.log(`\nRisorse disponibili:`);
  console.log(`  - Driver: ${drivers.length}`);
  drivers.forEach(d => {
    console.log(`    - ${d.name} (${d.type}, base: ${d.baseLocation?.name || 'N/A'})`);
  });
  console.log(`  - Rimorchi: ${trailers.length}`);

  // =========================================================================
  // SCENARIO A: 4 rimorchi pieni, 3 driver, 1 giorno
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO A: 4 rimorchi pieni, 3 driver, 1 giorno');
  console.log('='.repeat(70));

  // Elimina schedule esistenti con lo stesso nome (cleanup)
  // Prima elimina le relazioni, poi gli schedule
  const oldSchedules = await prisma.schedule.findMany({
    where: { name: { startsWith: 'Test Allocation' } },
    select: { id: true },
  });

  for (const sched of oldSchedules) {
    await prisma.tripTrailer.deleteMany({
      where: { trip: { scheduleId: sched.id } },
    });
    await prisma.trip.deleteMany({
      where: { scheduleId: sched.id },
    });
    await prisma.scheduleInitialState.deleteMany({
      where: { scheduleId: sched.id },
    });
    await prisma.scheduleVehicleState.deleteMany({
      where: { scheduleId: sched.id },
    });
  }
  await prisma.schedule.deleteMany({
    where: { name: { startsWith: 'Test Allocation' } },
  });

  // Crea schedule
  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-02');

  const schedule = await prisma.schedule.create({
    data: {
      name: `Test Allocation ${Date.now()}`,
      startDate,
      endDate,
      requiredLiters: 200000,  // Più del necessario per forzare l'ottimizzazione
      includeWeekend: false,
      status: 'DRAFT',
      initialStates: {
        create: trailers.slice(0, 4).map(t => ({
          trailerId: t.id,
          locationId: tiranoLocation.id,
          isFull: true,
        })),
      },
    },
  });

  console.log(`\nSchedule creato: ${schedule.id}`);
  console.log(`  - Periodo: ${startDate.toISOString().split('T')[0]} → ${endDate.toISOString().split('T')[0]}`);
  console.log(`  - Rimorchi pieni iniziali: 4`);

  // Tutti i driver disponibili
  const driverAvailability: DriverAvailabilityInput[] = drivers
    .filter(d => d.type === 'RESIDENT')
    .map(d => ({
      driverId: d.id,
      availableDates: ['2026-02-02'],
    }));

  // Esegui ottimizzazione
  console.log(`\nEsecuzione optimizeSchedule...`);
  const result = await optimizeSchedule(prisma, schedule.id, driverAvailability);

  console.log(`\nRisultato:`);
  console.log(`  - Success: ${result.success}`);
  console.log(`  - Trip generati: ${result.trips.length}`);
  console.log(`  - Litri totali: ${result.statistics.totalLiters.toLocaleString()}L`);
  console.log(`  - Ore guida totali: ${result.statistics.totalDrivingHours.toFixed(1)}h`);

  console.log(`\nBreakdown per tipo:`);
  console.log(`  - SHUTTLE_FROM_LIVIGNO: ${result.statistics.tripsByType.SHUTTLE_FROM_LIVIGNO}`);
  console.log(`  - SUPPLY_FROM_LIVIGNO: ${result.statistics.tripsByType.SUPPLY_FROM_LIVIGNO}`);
  console.log(`  - SHUTTLE_LIVIGNO: ${result.statistics.tripsByType.SHUTTLE_LIVIGNO}`);
  console.log(`  - TRANSFER_TIRANO: ${result.statistics.tripsByType.TRANSFER_TIRANO}`);
  console.log(`  - SUPPLY_MILANO: ${result.statistics.tripsByType.SUPPLY_MILANO}`);
  console.log(`  - FULL_ROUND: ${result.statistics.tripsByType.FULL_ROUND}`);

  if (result.warnings.length > 0) {
    console.log(`\nWarnings:`);
    result.warnings.forEach(w => console.log(`  ⚠️  ${w}`));
  }

  // Dettaglio trip per driver
  console.log(`\nDettaglio trip per driver:`);
  const tripsByDriver = new Map<string, TripSummary[]>();

  for (const trip of result.trips) {
    const driver = drivers.find(d => d.id === trip.driverId);
    const driverName = driver?.name || trip.driverId;

    if (!tripsByDriver.has(driverName)) {
      tripsByDriver.set(driverName, []);
    }

    const litersMap: Record<string, number> = {
      SHUTTLE_LIVIGNO: 17500,
      SHUTTLE_FROM_LIVIGNO: 17500,
      SUPPLY_FROM_LIVIGNO: 17500,
      FULL_ROUND: 17500,
      TRANSFER_TIRANO: 0,
      SUPPLY_MILANO: 0,
    };

    tripsByDriver.get(driverName)!.push({
      driverName,
      tripType: trip.tripType,
      departureTime: trip.departureTime.toTimeString().slice(0, 5),
      returnTime: trip.returnTime.toTimeString().slice(0, 5),
      liters: litersMap[trip.tripType] || 0,
    });
  }

  for (const [driverName, trips] of tripsByDriver) {
    const driver = drivers.find(d => d.name === driverName);
    const base = driver?.baseLocation?.name || 'N/A';
    const totalLiters = trips.reduce((sum, t) => sum + t.liters, 0);

    console.log(`\n  ${driverName} (${base}):`);
    console.log(`    Litri consegnati: ${totalLiters.toLocaleString()}L`);
    trips.forEach(t => {
      console.log(`    - ${t.departureTime} → ${t.returnTime}: ${t.tripType} (${t.liters.toLocaleString()}L)`);
    });
  }

  // Verifica logica driver in eccesso
  console.log(`\n` + '-'.repeat(70));
  console.log('VERIFICA LOGICA DRIVER IN ECCESSO');
  console.log('-'.repeat(70));

  const livignoDriver = drivers.find(d => d.baseLocationId === livignoLocation.id && d.type === 'RESIDENT');
  const tiranoResidentDrivers = drivers.filter(d => d.baseLocationId === tiranoLocation.id && d.type === 'RESIDENT');

  // Con 4 rimorchi pieni:
  // - Marco (Livigno) consuma 2 rimorchi con 2x SHUTTLE_FROM_LIVIGNO
  // - Restano 2 rimorchi per Tirano
  // - 2 rimorchi / 2 cicli per driver = 1 driver Tirano necessario
  // - Se ci sono 2 driver Tirano, 1 è in eccesso → dovrebbe fare SUPPLY

  const shuttlesFromLivigno = result.statistics.tripsByType.SHUTTLE_FROM_LIVIGNO;
  const supplyTrips = result.statistics.tripsByType.SUPPLY_MILANO;

  console.log(`\n  Consumo rimorchi da driver Livigno: ${shuttlesFromLivigno}`);
  console.log(`  Rimorchi rimasti per Tirano: ${4 - shuttlesFromLivigno}`);
  console.log(`  Driver Tirano disponibili: ${tiranoResidentDrivers.length}`);
  console.log(`  SUPPLY effettuati: ${supplyTrips}`);

  // Verifica warning "driver in eccesso"
  const excessWarning = result.warnings.find(w => w.includes('driver') && w.includes('eccesso'));
  if (excessWarning) {
    console.log(`\n  ✅ Warning corretto: "${excessWarning}"`);
  } else if (tiranoResidentDrivers.length > 1) {
    console.log(`\n  ⚠️  Nessun warning "driver in eccesso" trovato`);
  }

  // =========================================================================
  // SCENARIO B: Timing SUPPLY - verifica che SUPPLY parta quando rimorchio vuoto
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO B: Verifica timing SUPPLY');
  console.log('='.repeat(70));

  // Trova i trip SUPPLY
  const supplyTripsList = result.trips.filter(t => t.tripType === 'SUPPLY_MILANO');

  if (supplyTripsList.length > 0) {
    console.log(`\nTrip SUPPLY generati:`);
    for (const trip of supplyTripsList) {
      const driver = drivers.find(d => d.id === trip.driverId);
      console.log(`  - ${driver?.name}: ${trip.departureTime.toTimeString().slice(0, 5)} → ${trip.returnTime.toTimeString().slice(0, 5)}`);
    }

    // Il primo SUPPLY dovrebbe partire quando un rimorchio diventa vuoto
    // Dopo TRANSFER (30 min) o dopo SHUTTLE_FROM_LIVIGNO (Livigno→Tirano=90min + TRANSFER=30min)
    const firstSupply = supplyTripsList.sort((a, b) =>
      a.departureTime.getTime() - b.departureTime.getTime()
    )[0];

    const supplyStartHour = firstSupply.departureTime.getHours();
    const supplyStartMin = firstSupply.departureTime.getMinutes();
    const supplyStart = supplyStartHour + supplyStartMin / 60;

    console.log(`\n  Primo SUPPLY parte alle: ${firstSupply.departureTime.toTimeString().slice(0, 5)}`);

    // Se c'è un TRANSFER prima, SUPPLY può partire ~30 min dopo (06:30)
    // Se c'è SHUTTLE_FROM_LIVIGNO, il rimorchio diventa vuoto dopo 120 min (08:00)
    if (supplyStart >= 6.5) {  // >= 06:30
      console.log(`  ✅ Timing corretto: SUPPLY parte dopo che un rimorchio è diventato vuoto`);
    } else {
      console.log(`  ⚠️  SUPPLY parte troppo presto? Verificare logica`);
    }
  } else {
    console.log(`\n  Nessun SUPPLY generato in questo scenario`);
  }

  // =========================================================================
  // CLEANUP
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('CLEANUP');
  console.log('='.repeat(70));

  await prisma.tripTrailer.deleteMany({
    where: { trip: { scheduleId: schedule.id } },
  });
  await prisma.trip.deleteMany({
    where: { scheduleId: schedule.id },
  });
  await prisma.scheduleInitialState.deleteMany({
    where: { scheduleId: schedule.id },
  });
  await prisma.scheduleVehicleState.deleteMany({
    where: { scheduleId: schedule.id },
  });
  await prisma.schedule.delete({
    where: { id: schedule.id },
  });

  console.log(`\n  Schedule ${schedule.id} eliminato`);

  // =========================================================================
  // RIEPILOGO
  // =========================================================================
  console.log('\n' + '='.repeat(70));
  console.log('RIEPILOGO');
  console.log('='.repeat(70));

  const checks = [
    {
      name: 'Trip generati correttamente',
      passed: result.trips.length > 0,
    },
    {
      name: 'Litri consegnati > 0',
      passed: result.statistics.totalLiters > 0,
    },
    {
      name: 'SHUTTLE_FROM_LIVIGNO utilizzato',
      passed: result.statistics.tripsByType.SHUTTLE_FROM_LIVIGNO > 0,
    },
    {
      name: 'TRANSFER_TIRANO utilizzato',
      passed: result.statistics.tripsByType.TRANSFER_TIRANO > 0,
    },
    {
      name: 'Breakdown coerente',
      passed: result.statistics.tripsByType.SHUTTLE_LIVIGNO +
              result.statistics.tripsByType.SHUTTLE_FROM_LIVIGNO +
              result.statistics.tripsByType.SUPPLY_FROM_LIVIGNO +
              result.statistics.tripsByType.FULL_ROUND > 0,
    },
  ];

  const passedCount = checks.filter(c => c.passed).length;

  console.log('\n');
  checks.forEach(c => {
    console.log(`  ${c.passed ? '✅' : '❌'} ${c.name}`);
  });

  console.log(`\n  TOTALE: ${passedCount}/${checks.length} verifiche passate`);

  await prisma.$disconnect();
}

runTripGenerationTest().catch(console.error);
