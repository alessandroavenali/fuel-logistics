/**
 * Test per verificare che la disponibilità driver influenzi correttamente
 * sia il planner (optimizeSchedule) che il calcolo MAX (calculateMaxCapacity)
 */

import { PrismaClient } from '@prisma/client';
import { calculateMaxCapacity, DriverAvailabilityInput } from '../services/optimizer.service.js';

const prisma = new PrismaClient();

async function testDriverAvailabilityImpact() {
  console.log('='.repeat(60));
  console.log('TEST: Impatto disponibilità driver su calcolo MAX');
  console.log('='.repeat(60));

  // Ottieni driver attivi
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });

  console.log(`\nDriver attivi: ${drivers.length}`);
  drivers.forEach(d => {
    console.log(`  - ${d.name} (${d.type}, base: ${d.baseLocation?.name || 'N/A'})`);
  });

  // Periodo di test: 5 giorni lavorativi
  const startDate = new Date('2026-02-02'); // Lunedì
  const endDate = new Date('2026-02-06');   // Venerdì

  // Genera le date lavorative
  const workingDates: string[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    const day = current.getDay();
    if (day >= 1 && day <= 5) {
      workingDates.push(current.toISOString().split('T')[0]);
    }
    current.setDate(current.getDate() + 1);
  }
  console.log(`\nGiorni lavorativi: ${workingDates.join(', ')}`);

  // ============================================================
  // TEST 1: Tutti i driver RESIDENT disponibili tutti i giorni
  // ============================================================
  console.log('\n' + '-'.repeat(60));
  console.log('TEST 1: Tutti i RESIDENT disponibili tutti i giorni');
  console.log('-'.repeat(60));

  const residentDrivers = drivers.filter(d => d.type === 'RESIDENT');
  const allDaysAvailability: DriverAvailabilityInput[] = residentDrivers.map(d => ({
    driverId: d.id,
    availableDates: [...workingDates],
  }));

  const result1 = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    driverAvailability: allDaysAvailability,
  });

  console.log(`  Litri MAX: ${result1.maxLiters.toLocaleString()}L`);
  console.log(`  Giorni con consegne: ${result1.daysWithDeliveries}/${result1.workingDays}`);
  console.log(`  Breakdown: ${result1.breakdown.livignoDriverShuttles} shuttle Livigno, ` +
              `${result1.breakdown.tiranoDriverShuttles} shuttle Tirano, ` +
              `${result1.breakdown.supplyTrips} supply`);

  // ============================================================
  // TEST 2: Togli UN GIORNO a UN driver
  // ============================================================
  console.log('\n' + '-'.repeat(60));
  console.log('TEST 2: Togli mercoledì (2026-02-04) a un driver');
  console.log('-'.repeat(60));

  const oneDayLessAvailability: DriverAvailabilityInput[] = residentDrivers.map((d, index) => ({
    driverId: d.id,
    // Il primo driver non lavora mercoledì
    availableDates: index === 0
      ? workingDates.filter(date => date !== '2026-02-04')
      : [...workingDates],
  }));

  console.log(`  Driver ${residentDrivers[0]?.name}: disponibile ${oneDayLessAvailability[0]?.availableDates.length} giorni`);

  const result2 = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    driverAvailability: oneDayLessAvailability,
  });

  console.log(`  Litri MAX: ${result2.maxLiters.toLocaleString()}L`);
  console.log(`  Giorni con consegne: ${result2.daysWithDeliveries}/${result2.workingDays}`);
  console.log(`  Breakdown: ${result2.breakdown.livignoDriverShuttles} shuttle Livigno, ` +
              `${result2.breakdown.tiranoDriverShuttles} shuttle Tirano, ` +
              `${result2.breakdown.supplyTrips} supply`);

  // ============================================================
  // TEST 3: Togli DUE GIORNI a UN driver
  // ============================================================
  console.log('\n' + '-'.repeat(60));
  console.log('TEST 3: Togli mercoledì e giovedì a un driver');
  console.log('-'.repeat(60));

  const twoDaysLessAvailability: DriverAvailabilityInput[] = residentDrivers.map((d, index) => ({
    driverId: d.id,
    availableDates: index === 0
      ? workingDates.filter(date => !['2026-02-04', '2026-02-05'].includes(date))
      : [...workingDates],
  }));

  console.log(`  Driver ${residentDrivers[0]?.name}: disponibile ${twoDaysLessAvailability[0]?.availableDates.length} giorni`);

  const result3 = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    driverAvailability: twoDaysLessAvailability,
  });

  console.log(`  Litri MAX: ${result3.maxLiters.toLocaleString()}L`);
  console.log(`  Giorni con consegne: ${result3.daysWithDeliveries}/${result3.workingDays}`);
  console.log(`  Breakdown: ${result3.breakdown.livignoDriverShuttles} shuttle Livigno, ` +
              `${result3.breakdown.tiranoDriverShuttles} shuttle Tirano, ` +
              `${result3.breakdown.supplyTrips} supply`);

  // ============================================================
  // TEST 4: Aggiungi un driver ON_CALL per 2 giorni
  // ============================================================
  console.log('\n' + '-'.repeat(60));
  console.log('TEST 4: Aggiungi driver ON_CALL per giovedì e venerdì');
  console.log('-'.repeat(60));

  const onCallDrivers = drivers.filter(d => d.type === 'ON_CALL');

  if (onCallDrivers.length > 0) {
    const withOnCallAvailability: DriverAvailabilityInput[] = [
      ...allDaysAvailability,
      {
        driverId: onCallDrivers[0].id,
        availableDates: ['2026-02-05', '2026-02-06'], // Solo gio-ven
      },
    ];

    console.log(`  Driver ON_CALL ${onCallDrivers[0]?.name}: disponibile giovedì e venerdì`);

    const result4 = await calculateMaxCapacity(prisma, {
      startDate,
      endDate,
      driverAvailability: withOnCallAvailability,
    });

    console.log(`  Litri MAX: ${result4.maxLiters.toLocaleString()}L`);
    console.log(`  Giorni con consegne: ${result4.daysWithDeliveries}/${result4.workingDays}`);
    console.log(`  Breakdown: ${result4.breakdown.livignoDriverShuttles} shuttle Livigno, ` +
                `${result4.breakdown.tiranoDriverShuttles} shuttle Tirano, ` +
                `${result4.breakdown.supplyTrips} supply`);
  } else {
    console.log('  (Nessun driver ON_CALL nel sistema)');
  }

  // ============================================================
  // TEST 5: Togli UN GIORNO al driver Livigno (collo di bottiglia)
  // ============================================================
  console.log('\n' + '-'.repeat(60));
  console.log('TEST 5: Togli mercoledì al driver LIVIGNO (Marco Bianchi)');
  console.log('-'.repeat(60));

  const livignoDriver = drivers.find(d => d.baseLocation?.name?.includes('Livigno'));

  if (livignoDriver) {
    const livignoOneDayLess: DriverAvailabilityInput[] = residentDrivers.map(d => ({
      driverId: d.id,
      // Il driver Livigno non lavora mercoledì
      availableDates: d.id === livignoDriver.id
        ? workingDates.filter(date => date !== '2026-02-04')
        : [...workingDates],
    }));

    console.log(`  Driver Livigno ${livignoDriver.name}: disponibile ${livignoOneDayLess.find(a => a.driverId === livignoDriver.id)?.availableDates.length} giorni`);

    const result5 = await calculateMaxCapacity(prisma, {
      startDate,
      endDate,
      driverAvailability: livignoOneDayLess,
    });

    console.log(`  Litri MAX: ${result5.maxLiters.toLocaleString()}L`);
    console.log(`  Giorni con consegne: ${result5.daysWithDeliveries}/${result5.workingDays}`);
    console.log(`  Breakdown: ${result5.breakdown.livignoDriverShuttles} shuttle Livigno, ` +
                `${result5.breakdown.tiranoDriverShuttles} shuttle Tirano, ` +
                `${result5.breakdown.supplyTrips} supply`);

    const diff1vs5 = result1.maxLiters - result5.maxLiters;
    console.log(`\n  Differenza vs Test 1: ${diff1vs5 > 0 ? '-' : '+'}${Math.abs(diff1vs5).toLocaleString()}L`);

    if (diff1vs5 !== 0) {
      console.log(`  ✅ Togliere 1 giorno al driver Livigno influenza il risultato!`);
    } else {
      console.log(`  ⚠️  Risultato identico - il driver Livigno non è il collo di bottiglia?`);
    }
  } else {
    console.log('  (Nessun driver Livigno trovato)');
  }

  // ============================================================
  // RIEPILOGO
  // ============================================================
  console.log('\n' + '='.repeat(60));
  console.log('RIEPILOGO');
  console.log('='.repeat(60));

  const diff1vs2 = result1.maxLiters - result2.maxLiters;
  const diff1vs3 = result1.maxLiters - result3.maxLiters;

  console.log(`\n  Test 1 (tutti disponibili):     ${result1.maxLiters.toLocaleString()}L`);
  console.log(`  Test 2 (-1 giorno a 1 driver):  ${result2.maxLiters.toLocaleString()}L (${diff1vs2 > 0 ? '-' : '+'}${Math.abs(diff1vs2).toLocaleString()}L)`);
  console.log(`  Test 3 (-2 giorni a 1 driver):  ${result3.maxLiters.toLocaleString()}L (${diff1vs3 > 0 ? '-' : '+'}${Math.abs(diff1vs3).toLocaleString()}L)`);

  if (diff1vs2 !== 0 || diff1vs3 !== 0) {
    console.log('\n  ✅ La disponibilità driver influenza correttamente il calcolo MAX!');
  } else {
    console.log('\n  ⚠️  ATTENZIONE: I risultati sono identici - verificare la logica');
  }

  // Verifica bilanciamento SHUTTLE/SUPPLY
  console.log('\n' + '-'.repeat(60));
  console.log('VERIFICA BILANCIAMENTO SHUTTLE/SUPPLY');
  console.log('-'.repeat(60));

  const shuttleRatio1 = result1.breakdown.livignoDriverShuttles + result1.breakdown.tiranoDriverShuttles;
  const supplyRatio1 = result1.breakdown.supplyTrips;

  console.log(`  Test 1: ${shuttleRatio1} SHUTTLE, ${supplyRatio1} SUPPLY`);
  if (supplyRatio1 > 0) {
    console.log(`  ✅ Il bilanciamento SHUTTLE/SUPPLY è attivo`);
  } else {
    console.log(`  ⚠️  Nessun SUPPLY generato - verificare se ci sono cisterne vuote`);
  }

  await prisma.$disconnect();
}

// Esegui il test
testDriverAvailabilityImpact().catch(console.error);
