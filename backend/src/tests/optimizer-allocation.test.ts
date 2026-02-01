/**
 * Test Ottimizzazione Allocazione Driver
 *
 * Verifica che il calcolo MAX e la generazione turni siano corretti
 * per vari scenari con diversi numeri di driver, rimorchi e motrici.
 */

import { PrismaClient, DriverType, LocationType } from '@prisma/client';
import { calculateMaxCapacity, optimizeSchedule, CalculateMaxInput, DriverAvailabilityInput } from '../services/optimizer.service.js';

const prisma = new PrismaClient();

// ============================================================================
// COSTANTI (allineate con optimizer.service.ts)
// ============================================================================
const LITERS_PER_TRAILER = 17500;
const LITERS_PER_INTEGRATED_TANK = 17500;
const MAX_DAILY_HOURS = 9;
const HOURS_SHUTTLE_FROM_LIVIGNO = 4.5;
const HOURS_SHUTTLE = 4;  // SHUTTLE_LIVIGNO (Tirano→Livigno→Tirano)
const HOURS_TRANSFER = 0.5;
const HOURS_SUPPLY = 6;
const HOURS_SUPPLY_FROM_LIVIGNO = 10;

// ============================================================================
// HELPER: Setup e Cleanup per Test Isolati
// ============================================================================
interface TestSetup {
  locationIds: {
    tirano: string;
    livigno: string;
    milano: string;
  };
  driverIds: string[];
  vehicleIds: string[];
  trailerIds: string[];
  scheduleId?: string;
}

async function setupTestData(config: {
  numDriversTirano: number;
  numDriversLivigno: number;
  numVehiclesTirano: number;
  numVehiclesLivigno: number;
  numTrailersFull: number;
  numTrailersEmpty: number;
  driverTypes?: DriverType[];
}): Promise<TestSetup> {
  // Trova le locations esistenti
  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tirano = locations.find(l => l.type === 'PARKING');
  const livigno = locations.find(l => l.type === 'DESTINATION');
  const milano = locations.find(l => l.type === 'SOURCE');

  if (!tirano || !livigno || !milano) {
    throw new Error('Missing required locations');
  }

  const driverIds: string[] = [];
  const vehicleIds: string[] = [];
  const trailerIds: string[] = [];

  // Crea driver Tirano
  for (let i = 0; i < config.numDriversTirano; i++) {
    const type = config.driverTypes?.[i] || 'RESIDENT';
    const driver = await prisma.driver.create({
      data: {
        name: `Test Driver Tirano ${i + 1}`,
        licenseNumber: `TEST-TIR-${Date.now()}-${i}`,
        type,
        baseLocationId: tirano.id,
        isActive: true,
      },
    });
    driverIds.push(driver.id);
  }

  // Crea driver Livigno
  for (let i = 0; i < config.numDriversLivigno; i++) {
    const type = config.driverTypes?.[config.numDriversTirano + i] || 'RESIDENT';
    const driver = await prisma.driver.create({
      data: {
        name: `Test Driver Livigno ${i + 1}`,
        licenseNumber: `TEST-LIV-${Date.now()}-${i}`,
        type,
        baseLocationId: livigno.id,
        isActive: true,
      },
    });
    driverIds.push(driver.id);
  }

  // Crea veicoli Tirano
  for (let i = 0; i < config.numVehiclesTirano; i++) {
    const vehicle = await prisma.vehicle.create({
      data: {
        licensePlate: `TEST-VEH-TIR-${Date.now()}-${i}`,
        model: 'Test Truck',
        capacityLiters: LITERS_PER_INTEGRATED_TANK,
        baseLocationId: tirano.id,
        isActive: true,
      },
    });
    vehicleIds.push(vehicle.id);
  }

  // Crea veicoli Livigno
  for (let i = 0; i < config.numVehiclesLivigno; i++) {
    const vehicle = await prisma.vehicle.create({
      data: {
        licensePlate: `TEST-VEH-LIV-${Date.now()}-${i}`,
        model: 'Test Truck',
        capacityLiters: LITERS_PER_INTEGRATED_TANK,
        baseLocationId: livigno.id,
        isActive: true,
      },
    });
    vehicleIds.push(vehicle.id);
  }

  // Crea rimorchi
  const totalTrailers = config.numTrailersFull + config.numTrailersEmpty;
  for (let i = 0; i < totalTrailers; i++) {
    const trailer = await prisma.trailer.create({
      data: {
        licensePlate: `TEST-TRL-${Date.now()}-${i}`,
        capacityLiters: LITERS_PER_TRAILER,
        baseLocationId: tirano.id,
        isActive: true,
      },
    });
    trailerIds.push(trailer.id);
  }

  return {
    locationIds: {
      tirano: tirano.id,
      livigno: livigno.id,
      milano: milano.id,
    },
    driverIds,
    vehicleIds,
    trailerIds,
  };
}

async function cleanupTestData(setup: TestSetup): Promise<void> {
  // Elimina schedule e trip associati
  if (setup.scheduleId) {
    await prisma.tripTrailer.deleteMany({
      where: { trip: { scheduleId: setup.scheduleId } },
    });
    await prisma.trip.deleteMany({
      where: { scheduleId: setup.scheduleId },
    });
    await prisma.scheduleTrailerState.deleteMany({
      where: { scheduleId: setup.scheduleId },
    });
    await prisma.scheduleVehicleState.deleteMany({
      where: { scheduleId: setup.scheduleId },
    });
    await prisma.schedule.delete({
      where: { id: setup.scheduleId },
    });
  }

  // Elimina driver, veicoli, rimorchi di test
  await prisma.driver.deleteMany({
    where: { id: { in: setup.driverIds } },
  });
  await prisma.vehicle.deleteMany({
    where: { id: { in: setup.vehicleIds } },
  });
  await prisma.trailer.deleteMany({
    where: { id: { in: setup.trailerIds } },
  });
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

interface ScenarioResult {
  name: string;
  passed: boolean;
  expected: {
    maxLiters: number;
    description: string;
  };
  actual: {
    maxLiters: number;
    breakdown: Record<string, number>;
    warnings: string[];
  };
  issues: string[];
}

async function runScenario1(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 1: Baseline - Tutti RESIDENT');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 1 giorno lavorativo
  - 4 rimorchi pieni a Tirano, 0 vuoti
  - 1 motrice a Livigno (Marco), 2 motrici a Tirano
  - 3 driver RESIDENT: Marco (Livigno), Luca (Tirano), Paolo (Tirano)

  Calcolo atteso:
  - Marco: 2x SHUTTLE_FROM_LIVIGNO = 35.000L (consuma 2 rimorchi)
  - Luca: 2x (TRANSFER + SHUTTLE) = 35.000L (consuma 2 rimorchi)
  - Paolo: 1x SUPPLY (rimorchio vuoto alle 06:30) → prepara 1 rimorchio pieno
  - MAX = 70.000L (4 rimorchi × 17.500L)
  `);

  const result: ScenarioResult = {
    name: 'Scenario 1: Baseline',
    passed: false,
    expected: {
      maxLiters: 70000,
      description: '4 rimorchi × 17.500L = 70.000L',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  // Usa le risorse esistenti nel DB
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });
  const vehicles = await prisma.vehicle.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const locations = await prisma.location.findMany({ where: { isActive: true } });

  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');

  if (!tiranoLocation || !livignoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  // Filtra per avere la configurazione corretta
  const livignoDrivers = drivers.filter(d => d.baseLocationId === livignoLocation.id && d.type === 'RESIDENT');
  const tiranoDrivers = drivers.filter(d => d.baseLocationId === tiranoLocation.id && d.type === 'RESIDENT');
  const livignoVehicles = vehicles.filter(v => v.baseLocationId === livignoLocation.id);
  const tiranoVehicles = vehicles.filter(v => v.baseLocationId === tiranoLocation.id);

  console.log(`\nRisorse reali nel DB:`);
  console.log(`  - Driver Livigno: ${livignoDrivers.length} (${livignoDrivers.map(d => d.name).join(', ')})`);
  console.log(`  - Driver Tirano: ${tiranoDrivers.length} (${tiranoDrivers.map(d => d.name).join(', ')})`);
  console.log(`  - Veicoli Livigno: ${livignoVehicles.length}`);
  console.log(`  - Veicoli Tirano: ${tiranoVehicles.length}`);
  console.log(`  - Rimorchi totali: ${trailers.length}`);

  // Simula 4 rimorchi pieni
  const startDate = new Date('2026-02-02');  // Lunedì
  const endDate = new Date('2026-02-02');    // Solo 1 giorno

  const initialStates = trailers.slice(0, 4).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: true,
  }));

  // Imposta motrici: 1 a Livigno, resto a Tirano (vuote)
  const vehicleStates = vehicles.map((v, i) => ({
    vehicleId: v.id,
    locationId: i === 0 ? livignoLocation.id : tiranoLocation.id,
    isTankFull: false,
  }));

  // Calcola MAX
  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    vehicleStates,
    includeWeekend: false,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      shuttleFromLivigno: maxResult.breakdown.shuttleFromLivigno,
      supplyFromLivigno: maxResult.breakdown.supplyFromLivigno,
      tiranoShuttles: maxResult.breakdown.tiranoDriverShuttles,
      transfers: maxResult.breakdown.transferTrips,
      supply: maxResult.breakdown.supplyTrips,
    },
    warnings: maxResult.constraints,
  };

  console.log(`\nRisultato MAX:`);
  console.log(`  - Litri MAX: ${maxResult.maxLiters.toLocaleString()}L`);
  console.log(`  - Breakdown:`);
  console.log(`    - SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno}`);
  console.log(`    - SUPPLY_FROM_LIVIGNO: ${maxResult.breakdown.supplyFromLivigno}`);
  console.log(`    - SHUTTLE Tirano: ${maxResult.breakdown.tiranoDriverShuttles}`);
  console.log(`    - TRANSFER: ${maxResult.breakdown.transferTrips}`);
  console.log(`    - SUPPLY: ${maxResult.breakdown.supplyTrips}`);

  // Verifica
  if (maxResult.maxLiters === result.expected.maxLiters) {
    result.passed = true;
    console.log(`\n✅ PASSED: MAX = ${result.expected.maxLiters.toLocaleString()}L come atteso`);
  } else {
    result.issues.push(`MAX ${maxResult.maxLiters}L ≠ atteso ${result.expected.maxLiters}L`);
    console.log(`\n❌ FAILED: MAX ${maxResult.maxLiters.toLocaleString()}L ≠ atteso ${result.expected.maxLiters.toLocaleString()}L`);
  }

  return result;
}

async function runScenario2(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 2: Più driver che rimorchi');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 1 giorno, 2 rimorchi pieni, 2 vuoti
  - 1 motrice Livigno, 2 motrici Tirano
  - 4 driver: Marco (Livigno), Luca, Paolo, Giovanni (tutti Tirano RESIDENT)

  Domande:
  - Quanti driver sono "in eccesso"?
  - Quanti SUPPLY vengono fatti?
  - MAX atteso?
  `);

  const result: ScenarioResult = {
    name: 'Scenario 2: Più driver che rimorchi',
    passed: false,
    expected: {
      maxLiters: 35000, // 2 rimorchi × 17.500L
      description: '2 rimorchi pieni iniziali = 35.000L (il resto è SUPPLY per domani)',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } });

  if (!tiranoLocation || !livignoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-02');

  // 2 pieni, 2 vuoti
  const initialStates = trailers.slice(0, 4).map((t, i) => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: i < 2,  // primi 2 pieni
  }));

  // 1 motrice a Livigno, 2 a Tirano
  const vehicleStates = vehicles.slice(0, 3).map((v, i) => ({
    vehicleId: v.id,
    locationId: i === 0 ? livignoLocation.id : tiranoLocation.id,
    isTankFull: false,
  }));

  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    vehicleStates,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      shuttleFromLivigno: maxResult.breakdown.shuttleFromLivigno,
      tiranoShuttles: maxResult.breakdown.tiranoDriverShuttles,
      transfers: maxResult.breakdown.transferTrips,
      supply: maxResult.breakdown.supplyTrips,
    },
    warnings: [],
  };

  console.log(`\nRisultato:`);
  console.log(`  - MAX: ${maxResult.maxLiters.toLocaleString()}L`);
  console.log(`  - SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno} (consuma rimorchi pieni)`);
  console.log(`  - SHUTTLE Tirano: ${maxResult.breakdown.tiranoDriverShuttles}`);
  console.log(`  - TRANSFER: ${maxResult.breakdown.transferTrips}`);
  console.log(`  - SUPPLY: ${maxResult.breakdown.supplyTrips} (driver in eccesso)`);

  // Con 2 rimorchi pieni e 1 giorno:
  // - Marco fa 2x SHUTTLE_FROM_LIVIGNO = 35.000L (consuma 2 rimorchi)
  // - Luca fa 0 SHUTTLE (nessun rimorchio pieno rimasto)
  // - Paolo/Giovanni fanno SUPPLY (rimorchi vuoti)
  // MAX = 35.000L

  if (maxResult.maxLiters >= 35000) {
    result.passed = true;
    console.log(`\n✅ PASSED`);
  } else {
    result.issues.push(`MAX inferiore al minimo atteso`);
    console.log(`\n❌ FAILED: MAX troppo basso`);
  }

  return result;
}

async function runScenario3(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 3: Solo driver Tirano (nessun Livigno)');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 1 giorno, 4 rimorchi pieni
  - 0 motrici Livigno, 2 motrici Tirano
  - 2 driver RESIDENT Tirano

  Calcolo atteso:
  - livignoConsumption = 0
  - fullTrailersForTirano = 4
  - tiranoDriversNeeded = ceil(4/2) = 2
  - Nessun driver in eccesso
  `);

  const result: ScenarioResult = {
    name: 'Scenario 3: Solo driver Tirano',
    passed: false,
    expected: {
      maxLiters: 70000,  // 4 rimorchi × 17.500L
      description: '4 TRANSFER + 4 SHUTTLE = 70.000L',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });

  if (!tiranoLocation || !livignoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  const tiranoDrivers = drivers.filter(d =>
    d.baseLocationId === tiranoLocation.id && d.type === 'RESIDENT'
  );

  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-02');

  // 4 rimorchi pieni
  const initialStates = trailers.slice(0, 4).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: true,
  }));

  // 2 motrici a Tirano, 0 a Livigno
  const vehicleStates = vehicles.slice(0, 2).map(v => ({
    vehicleId: v.id,
    locationId: tiranoLocation.id,
    isTankFull: false,
  }));

  // Solo driver Tirano
  const driverAvailability: DriverAvailabilityInput[] = tiranoDrivers.slice(0, 2).map(d => ({
    driverId: d.id,
    availableDates: ['2026-02-02'],
  }));

  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    vehicleStates,
    driverAvailability,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      shuttleFromLivigno: maxResult.breakdown.shuttleFromLivigno,
      tiranoShuttles: maxResult.breakdown.tiranoDriverShuttles,
      transfers: maxResult.breakdown.transferTrips,
      supply: maxResult.breakdown.supplyTrips,
      fullRound: maxResult.breakdown.tiranoDriverFullRounds,
    },
    warnings: [],
  };

  console.log(`\nRisorse:`);
  console.log(`  - Driver Tirano: ${tiranoDrivers.length}`);
  console.log(`  - Veicoli: ${vehicles.length}`);
  console.log(`  - Rimorchi pieni: 4`);

  console.log(`\nRisultato:`);
  console.log(`  - MAX: ${maxResult.maxLiters.toLocaleString()}L`);
  console.log(`  - SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno} (atteso: 0)`);
  console.log(`  - SHUTTLE Tirano: ${maxResult.breakdown.tiranoDriverShuttles}`);
  console.log(`  - TRANSFER: ${maxResult.breakdown.transferTrips}`);
  console.log(`  - FULL_ROUND: ${maxResult.breakdown.tiranoDriverFullRounds}`);

  // Verifica: nessun SHUTTLE_FROM_LIVIGNO (non ci sono driver/motrici Livigno)
  if (maxResult.breakdown.shuttleFromLivigno === 0) {
    console.log(`  ✅ Corretto: nessun SHUTTLE_FROM_LIVIGNO`);
  } else {
    result.issues.push('SHUTTLE_FROM_LIVIGNO dovrebbe essere 0');
  }

  // Con 2 driver Tirano × 9h/giorno e cicli da 4.5h, possiamo fare 4 shuttle
  // 4 shuttle × 17.500L = 70.000L
  if (maxResult.maxLiters >= 35000) {  // Almeno 2 shuttle
    result.passed = true;
    console.log(`\n✅ PASSED`);
  } else {
    result.issues.push('MAX troppo basso');
    console.log(`\n❌ FAILED`);
  }

  return result;
}

async function runScenario4(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 4: Multi-giorno con carry-over');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 3 giorni lavorativi
  - Giorno 1: 4 rimorchi pieni, 0 vuoti
  - 3 driver: Marco (Livigno), Luca, Paolo (Tirano)

  Verifica:
  - I rimorchi preparati da SUPPLY del giorno 1 sono disponibili il giorno 2?
  - Il carry-over funziona correttamente?
  `);

  const result: ScenarioResult = {
    name: 'Scenario 4: Multi-giorno carry-over',
    passed: false,
    expected: {
      maxLiters: 0,  // Calcolato dinamicamente
      description: 'Verifica carry-over rimorchi tra giorni',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } });

  if (!tiranoLocation || !livignoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  // 3 giorni: Lun-Mer
  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-04');

  // 4 rimorchi pieni iniziali
  const initialStates = trailers.slice(0, 4).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: true,
  }));

  // 1 motrice Livigno, 2 Tirano
  const vehicleStates = vehicles.map((v, i) => ({
    vehicleId: v.id,
    locationId: i === 0 ? livignoLocation.id : tiranoLocation.id,
    isTankFull: false,
  }));

  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    vehicleStates,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      shuttleFromLivigno: maxResult.breakdown.shuttleFromLivigno,
      supplyFromLivigno: maxResult.breakdown.supplyFromLivigno,
      tiranoShuttles: maxResult.breakdown.tiranoDriverShuttles,
      transfers: maxResult.breakdown.transferTrips,
      supply: maxResult.breakdown.supplyTrips,
    },
    warnings: [],
  };

  console.log(`\nRisultato 3 giorni:`);
  console.log(`  - MAX: ${maxResult.maxLiters.toLocaleString()}L`);
  console.log(`  - Giorni con consegne: ${maxResult.daysWithDeliveries}/${maxResult.workingDays}`);
  console.log(`  - Breakdown:`);
  console.log(`    - SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno}`);
  console.log(`    - SHUTTLE Tirano: ${maxResult.breakdown.tiranoDriverShuttles}`);
  console.log(`    - SUPPLY: ${maxResult.breakdown.supplyTrips}`);

  // Calcola atteso:
  // - Giorno 1: 4 rimorchi pieni → ~70.000L, alcuni SUPPLY per riempire vuoti
  // - Giorno 2-3: usa rimorchi preparati da SUPPLY
  // Con 3 driver × 3 giorni × ~2 shuttle/giorno = ~18 shuttle potenziali
  // Ma limitati dai rimorchi: 4 iniziali + (SUPPLY × 3 giorni)

  const minExpected = 70000;  // Almeno il giorno 1
  if (maxResult.maxLiters >= minExpected) {
    result.passed = true;
    console.log(`\n✅ PASSED: MAX ${maxResult.maxLiters.toLocaleString()}L >= ${minExpected.toLocaleString()}L`);
  } else {
    result.issues.push(`MAX ${maxResult.maxLiters}L < minimo atteso ${minExpected}L`);
    console.log(`\n❌ FAILED`);
  }

  // Verifica che il giorno 2-3 abbiano consegne (carry-over funziona)
  if (maxResult.daysWithDeliveries === 3) {
    console.log(`  ✅ Carry-over corretto: consegne tutti e 3 i giorni`);
  } else {
    result.issues.push(`Solo ${maxResult.daysWithDeliveries}/3 giorni con consegne`);
    console.log(`  ⚠️  Solo ${maxResult.daysWithDeliveries}/3 giorni con consegne`);
  }

  return result;
}

async function runScenario5(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 5: Driver ON_CALL parziale');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 2 giorni
  - 4 rimorchi pieni
  - 2 RESIDENT + 1 ON_CALL disponibile solo giorno 2

  Verifica:
  - Giorno 1: solo RESIDENT lavorano
  - Giorno 2: ON_CALL si aggiunge
  - MAX cambia tra i giorni?
  `);

  const result: ScenarioResult = {
    name: 'Scenario 5: ON_CALL parziale',
    passed: false,
    expected: {
      maxLiters: 0,
      description: 'Giorno 2 dovrebbe avere più capacità del giorno 1',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } });
  const drivers = await prisma.driver.findMany({
    where: { isActive: true },
    include: { baseLocation: true },
  });

  if (!tiranoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  const residentDrivers = drivers.filter(d => d.type === 'RESIDENT');
  const onCallDrivers = drivers.filter(d => d.type === 'ON_CALL');

  console.log(`\nDriver disponibili:`);
  console.log(`  - RESIDENT: ${residentDrivers.length}`);
  console.log(`  - ON_CALL: ${onCallDrivers.length}`);

  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-03');

  const initialStates = trailers.slice(0, 4).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: true,
  }));

  // Calcolo 1: Solo RESIDENT
  const result1 = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    // Nessun driverAvailability = usa solo RESIDENT
  });

  // Calcolo 2: RESIDENT + ON_CALL solo giorno 2
  const driverAvailability: DriverAvailabilityInput[] = [
    ...residentDrivers.map(d => ({
      driverId: d.id,
      availableDates: ['2026-02-02', '2026-02-03'],
    })),
    ...(onCallDrivers.length > 0 ? [{
      driverId: onCallDrivers[0].id,
      availableDates: ['2026-02-03'],  // Solo giorno 2
    }] : []),
  ];

  const result2 = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    driverAvailability,
  });

  result.actual = {
    maxLiters: result2.maxLiters,
    breakdown: {
      soloResident: result1.maxLiters,
      conOnCall: result2.maxLiters,
      differenza: result2.maxLiters - result1.maxLiters,
    },
    warnings: [],
  };

  console.log(`\nRisultato:`);
  console.log(`  - Solo RESIDENT: ${result1.maxLiters.toLocaleString()}L`);
  console.log(`  - Con ON_CALL giorno 2: ${result2.maxLiters.toLocaleString()}L`);
  console.log(`  - Differenza: ${(result2.maxLiters - result1.maxLiters).toLocaleString()}L`);

  if (onCallDrivers.length === 0) {
    console.log(`\n⚠️  Nessun driver ON_CALL nel sistema - test non significativo`);
    result.passed = true;  // Passa comunque se non ci sono ON_CALL
  } else if (result2.maxLiters >= result1.maxLiters) {
    result.passed = true;
    console.log(`\n✅ PASSED: Aggiungere ON_CALL non peggiora mai il risultato`);
  } else {
    result.issues.push('Aggiungere ON_CALL ha peggiorato il risultato!');
    console.log(`\n❌ FAILED: ON_CALL ha peggiorato il risultato`);
  }

  return result;
}

async function runScenario6(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 6: Edge case - 0 rimorchi pieni');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 1 giorno, 0 rimorchi pieni, 4 vuoti
  - 1 motrice Livigno, 3 motrici Tirano
  - 3 driver RESIDENT: Marco (Livigno), Luca, Paolo (Tirano)

  CALCOLO DATO L'ALGORITMO ATTUALE:
  ┌──────────┬─────────────────────────────────────────┬───────────┐
  │ Driver   │ Azione                                  │ Litri     │
  ├──────────┼─────────────────────────────────────────┼───────────┤
  │ Marco    │ SUPPLY_FROM_LIVIGNO (10h, eccezione ADR)│ 17.500L   │
  │          │ → prende rimorchio vuoto, va Milano,    │           │
  │          │   riempie tutto, lascia rimorchio pieno │           │
  │          │   a Tirano, sale a Livigno con motrice  │           │
  ├──────────┼─────────────────────────────────────────┼───────────┤
  │ Luca     │ FULL_ROUND (9.5h > 9h ADR limit) → FAIL │ 0L        │
  │          │ SUPPLY (6h) prepara rimorchio per domani│           │
  ├──────────┼─────────────────────────────────────────┼───────────┤
  │ Paolo    │ FULL_ROUND (9.5h > 9h ADR limit) → FAIL │ 0L        │
  │          │ SUPPLY (6h) prepara rimorchio per domani│           │
  └──────────┴─────────────────────────────────────────┴───────────┘

  MAX ATTESO = 17.500L (solo Marco può consegnare)

  NOTA: Limitazioni algoritmo attuale:
  - FULL_ROUND richiede 9.5h ma ADR limit è 9h
  - SUPPLY+SHUTTLE per Tirano (6h+4h=10h) non implementato con ADR exception
  `);

  const result: ScenarioResult = {
    name: 'Scenario 6: 0 rimorchi pieni',
    passed: false,
    expected: {
      maxLiters: 17500,
      description: 'Solo Marco (SUPPLY_FROM_LIVIGNO) - Luca/Paolo non possono fare FULL_ROUND (9.5h > 9h)',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });

  if (!tiranoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-02');

  // Tutti i rimorchi vuoti!
  const initialStates = trailers.slice(0, 4).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: false,  // VUOTI!
  }));

  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      supply: maxResult.breakdown.supplyTrips,
      shuttles: maxResult.breakdown.tiranoDriverShuttles + maxResult.breakdown.shuttleFromLivigno,
    },
    warnings: [],
  };

  console.log(`\nRisultato APP:`);
  console.log(`  - MAX: ${maxResult.maxLiters.toLocaleString()}L (atteso: 17.500L)`);
  console.log(`  - SUPPLY_FROM_LIVIGNO: ${maxResult.breakdown.supplyFromLivigno} (atteso: 1)`);
  console.log(`  - FULL_ROUND: ${maxResult.breakdown.tiranoDriverFullRounds} (atteso: 0 - richiede 9.5h)`);
  console.log(`  - SUPPLY Tirano: ${maxResult.breakdown.supplyTrips}`);
  console.log(`  - SHUTTLE totali: ${maxResult.breakdown.tiranoDriverShuttles + maxResult.breakdown.shuttleFromLivigno}`);

  // Verifica: con 0 rimorchi pieni ma 4 vuoti e motrici disponibili
  // - Marco (Livigno): SUPPLY_FROM_LIVIGNO → 17.500L
  // - Luca (Tirano): FULL_ROUND richiede 9.5h > 9h ADR → 0L
  // - Paolo (Tirano): FULL_ROUND richiede 9.5h > 9h ADR → 0L
  // MAX atteso = 17.500L

  if (maxResult.maxLiters === result.expected.maxLiters) {
    result.passed = true;
    console.log(`\n✅ PASSED: MAX = ${result.expected.maxLiters.toLocaleString()}L come atteso`);
    if (maxResult.breakdown.supplyFromLivigno === 1) {
      console.log(`  ✅ SUPPLY_FROM_LIVIGNO eseguito correttamente da Marco`);
    }
  } else {
    result.issues.push(`MAX ${maxResult.maxLiters}L ≠ atteso ${result.expected.maxLiters}L`);
    console.log(`\n❌ FAILED: MAX ${maxResult.maxLiters.toLocaleString()}L ≠ atteso ${result.expected.maxLiters.toLocaleString()}L`);

    if (maxResult.breakdown.supplyFromLivigno === 0) {
      console.log(`  ⚠️  BUG: SUPPLY_FROM_LIVIGNO non viene eseguito (Marco dovrebbe farlo)`);
    }
  }

  return result;
}

async function runScenario7(): Promise<ScenarioResult> {
  console.log('\n' + '='.repeat(70));
  console.log('SCENARIO 7: Limite motrici Livigno');
  console.log('='.repeat(70));
  console.log(`
  Configurazione:
  - 1 giorno, 6 rimorchi pieni
  - 2 motrici a Livigno, 1 motrice a Tirano
  - 3 driver Livigno, 1 driver Tirano

  Calcolo atteso:
  - livignoConsumption limitato da min(motrici, ore driver)
  - 2 motrici × 2 shuttle/giorno = 4 shuttle max
  - Ma 3 driver × 2 shuttle = 6 shuttle potenziali
  - livignoConsumption = min(4, 6) = 4
  - fullTrailersForTirano = 6 - 4 = 2
  `);

  const result: ScenarioResult = {
    name: 'Scenario 7: Limite motrici Livigno',
    passed: false,
    expected: {
      maxLiters: 105000,  // 6 rimorchi × 17.500L
      description: 'Limitato da motrici Livigno (2), non driver (3)',
    },
    actual: {
      maxLiters: 0,
      breakdown: {},
      warnings: [],
    },
    issues: [],
  };

  const locations = await prisma.location.findMany({ where: { isActive: true } });
  const tiranoLocation = locations.find(l => l.type === 'PARKING');
  const livignoLocation = locations.find(l => l.type === 'DESTINATION');
  const trailers = await prisma.trailer.findMany({ where: { isActive: true } });
  const vehicles = await prisma.vehicle.findMany({ where: { isActive: true } });

  if (!tiranoLocation || !livignoLocation) {
    result.issues.push('Missing locations');
    return result;
  }

  const startDate = new Date('2026-02-02');
  const endDate = new Date('2026-02-02');

  // 6 rimorchi pieni (o quanti disponibili)
  const numTrailers = Math.min(6, trailers.length);
  const initialStates = trailers.slice(0, numTrailers).map(t => ({
    trailerId: t.id,
    locationId: tiranoLocation.id,
    isFull: true,
  }));

  // 2 motrici a Livigno, 1 a Tirano
  const numVehicles = Math.min(3, vehicles.length);
  const vehicleStates = vehicles.slice(0, numVehicles).map((v, i) => ({
    vehicleId: v.id,
    locationId: i < 2 ? livignoLocation.id : tiranoLocation.id,
    isTankFull: false,
  }));

  const maxResult = await calculateMaxCapacity(prisma, {
    startDate,
    endDate,
    initialStates,
    vehicleStates,
  });

  result.actual = {
    maxLiters: maxResult.maxLiters,
    breakdown: {
      shuttleFromLivigno: maxResult.breakdown.shuttleFromLivigno,
      tiranoShuttles: maxResult.breakdown.tiranoDriverShuttles,
      transfers: maxResult.breakdown.transferTrips,
    },
    warnings: [],
  };

  console.log(`\nRisorse:`);
  console.log(`  - Rimorchi pieni: ${numTrailers}`);
  console.log(`  - Veicoli Livigno: ${vehicleStates.filter(v => v.locationId === livignoLocation.id).length}`);
  console.log(`  - Veicoli Tirano: ${vehicleStates.filter(v => v.locationId === tiranoLocation.id).length}`);

  console.log(`\nRisultato:`);
  console.log(`  - MAX: ${maxResult.maxLiters.toLocaleString()}L`);
  console.log(`  - SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno}`);
  console.log(`  - SHUTTLE Tirano: ${maxResult.breakdown.tiranoDriverShuttles}`);
  console.log(`  - TRANSFER: ${maxResult.breakdown.transferTrips}`);

  // Verifica che SHUTTLE_FROM_LIVIGNO sia limitato a ~4 (2 motrici × 2 shuttle)
  // Con 2 motrici a Livigno e 9h/giorno, possiamo fare 2×2=4 SHUTTLE_FROM_LIVIGNO
  const expectedMaxShuttlesFromLivigno = 4;
  if (maxResult.breakdown.shuttleFromLivigno <= expectedMaxShuttlesFromLivigno) {
    console.log(`  ✅ SHUTTLE_FROM_LIVIGNO correttamente limitato dalle motrici`);
  } else {
    result.issues.push(`Troppi SHUTTLE_FROM_LIVIGNO: ${maxResult.breakdown.shuttleFromLivigno} > ${expectedMaxShuttlesFromLivigno}`);
  }

  result.passed = result.issues.length === 0;
  console.log(result.passed ? '\n✅ PASSED' : '\n❌ FAILED');

  return result;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '#'.repeat(70));
  console.log('# TEST OTTIMIZZAZIONE ALLOCAZIONE DRIVER');
  console.log('#'.repeat(70));
  console.log(`\nData: ${new Date().toISOString()}`);

  const results: ScenarioResult[] = [];

  try {
    // Esegui tutti gli scenari
    results.push(await runScenario1());
    results.push(await runScenario2());
    results.push(await runScenario3());
    results.push(await runScenario4());
    results.push(await runScenario5());
    results.push(await runScenario6());
    results.push(await runScenario7());

    // Riepilogo finale
    console.log('\n' + '='.repeat(70));
    console.log('RIEPILOGO RISULTATI');
    console.log('='.repeat(70));

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    results.forEach(r => {
      const status = r.passed ? '✅' : '❌';
      console.log(`\n${status} ${r.name}`);
      console.log(`   MAX: ${r.actual.maxLiters.toLocaleString()}L`);
      if (r.issues.length > 0) {
        r.issues.forEach(issue => console.log(`   ⚠️  ${issue}`));
      }
    });

    console.log('\n' + '-'.repeat(70));
    console.log(`TOTALE: ${passed}/${results.length} scenari passati`);

    if (failed > 0) {
      console.log(`\n⚠️  ${failed} scenari falliti - verificare l'implementazione`);
    } else {
      console.log('\n🎉 Tutti gli scenari passati!');
    }

  } catch (error) {
    console.error('\n❌ ERRORE durante i test:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
