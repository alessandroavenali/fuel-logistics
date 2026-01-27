// ============================================================================
// ALGORITMO DI OTTIMIZZAZIONE GLOBALE V2
// ============================================================================
// Traccia le ore per ogni driver individualmente.
// I driver possono scambiarsi di posto quando si incontrano (risorse condivise).
// ============================================================================

const HOURS = {
  SUPPLY: 6,
  TRANSFER: 0.5,
  SHUTTLE: 4.5,
  FULL_ROUND: 9,
};

const LITERS_PER_TANK = 17500;
const MAX_DRIVER_HOURS = 9;

interface DriverState {
  id: string;
  hoursLeft: number;
}

interface DayPlan {
  date: string;
  supplyTrips: number;
  transferTrips: number;
  shuttleTrips: number;
  fullRoundTrips: number;
  litersDelivered: number;
  hoursUsedPerDriver: Map<string, number>;
  endState: {
    fullTrailers: number;
    emptyTrailers: number;
    fullTanks: number;
  };
}

interface GlobalResult {
  totalLiters: number;
  dayPlans: DayPlan[];
  breakdown: {
    supplyTrips: number;
    transferTrips: number;
    shuttleTrips: number;
    fullRoundTrips: number;
  };
  daysWithDeliveries: number;
}

/**
 * Calcola il MAX con tracciamento individuale delle ore driver.
 *
 * @param numDays - Numero di giorni lavorativi
 * @param driversPerDay - Array di array: per ogni giorno, lista di driver disponibili con ore max
 * @param numTrailers - Numero di rimorchi disponibili
 * @param numVehicles - Numero di motrici a Tirano
 * @param initialFullTrailers - Rimorchi pieni all'inizio
 * @param initialFullTanks - Cisterne piene all'inizio
 */
export function calculateGlobalMaxV2(
  numDays: number,
  driversPerDay: { id: string; maxHours: number }[][],
  numTrailers: number,
  numVehicles: number,
  initialFullTrailers: number = 0,
  initialFullTanks: number = 0
): GlobalResult {
  if (numDays === 0 || driversPerDay.length === 0) {
    return {
      totalLiters: 0,
      dayPlans: [],
      breakdown: { supplyTrips: 0, transferTrips: 0, shuttleTrips: 0, fullRoundTrips: 0 },
      daysWithDeliveries: 0,
    };
  }

  // Stato risorse (condivise tra tutti i driver)
  let fullTrailers = initialFullTrailers;
  let emptyTrailers = numTrailers - initialFullTrailers;
  let fullTanks = initialFullTanks;
  let emptyTanks = numVehicles - initialFullTanks; // Motrici con cisterna vuota

  // Risorse "in transito" (create oggi, disponibili più tardi oggi stesso)
  // Nota: SUPPLY dura 6h, quindi le risorse tornano dopo 6h
  // Per semplicità, assumiamo che le risorse SUPPLY siano disponibili a metà giornata

  // Contatori totali
  let totalLiters = 0;
  let totalSupply = 0;
  let totalTransfer = 0;
  let totalShuttle = 0;
  let totalFullRound = 0;
  let daysWithDeliveries = 0;

  const dayPlans: DayPlan[] = [];

  for (let day = 0; day < numDays; day++) {
    const driversToday = driversPerDay[day] || [];
    const remainingDays = numDays - day;
    const isLastDay = remainingDays === 1;

    // Stato driver per oggi (copia per non modificare l'input)
    const driverStates: DriverState[] = driversToday.map(d => ({
      id: d.id,
      hoursLeft: d.maxHours,
    }));

    let litersToday = 0;
    let supplyToday = 0;
    let transferToday = 0;
    let shuttleToday = 0;
    let fullRoundToday = 0;

    // Risorse che arriveranno dopo i SUPPLY (a metà giornata)
    let pendingFullTrailers = 0;
    let pendingFullTanks = 0;
    let supplyCompleted = false; // Flag per sapere quando i SUPPLY sono tornati

    // =========================================================================
    // FASE 1: SUPPLY (primi trip della giornata)
    // =========================================================================
    // I driver che fanno SUPPLY partono la mattina e tornano dopo 6h.
    // Le risorse create sono disponibili per SHUTTLE nel pomeriggio.

    if (!isLastDay) {
      // Calcola quanti SUPPLY servono
      // Stima: vogliamo abbastanza risorse per domani
      const tomorrowDrivers = driversPerDay[day + 1] || [];
      const tomorrowHours = tomorrowDrivers.reduce((sum, d) => sum + d.maxHours, 0);
      const tomorrowShuttlePotential = Math.floor(tomorrowHours / HOURS.SHUTTLE);

      // Risorse attuali + quelle che creeremo oggi
      const currentResources = fullTanks + fullTrailers + pendingFullTanks + pendingFullTrailers;
      const resourcesNeeded = Math.max(0, tomorrowShuttlePotential - currentResources);
      const suppliesWanted = Math.ceil(resourcesNeeded / 2); // Ogni SUPPLY crea 2 risorse

      // Fai SUPPLY con i driver che hanno tempo
      let suppliesDone = 0;
      for (const driver of driverStates) {
        if (suppliesDone >= suppliesWanted) break;
        if (driver.hoursLeft < HOURS.SUPPLY) continue;
        if (emptyTrailers <= 0) break;
        if (emptyTanks <= 0) break; // Serve una motrice per SUPPLY

        // Fai SUPPLY
        driver.hoursLeft -= HOURS.SUPPLY;
        emptyTrailers--;
        emptyTanks--;
        pendingFullTrailers++;
        pendingFullTanks++;
        supplyToday++;
        suppliesDone++;
      }
    }

    // =========================================================================
    // FASE 2: Le risorse SUPPLY arrivano (simuliamo passaggio del tempo)
    // =========================================================================
    fullTrailers += pendingFullTrailers;
    fullTanks += pendingFullTanks;
    emptyTanks += supplyToday; // Le motrici tornano (con cisterna piena)
    pendingFullTrailers = 0;
    pendingFullTanks = 0;

    // =========================================================================
    // FASE 3: SHUTTLE e TRANSFER (pomeriggio / ore rimanenti)
    // =========================================================================
    // Ora usiamo le risorse disponibili per consegnare

    let madeProgress = true;
    let iterations = 0;
    const maxIterations = 100;

    while (madeProgress && iterations < maxIterations) {
      madeProgress = false;
      iterations++;

      // Trova il driver con più ore disponibili
      const availableDrivers = driverStates
        .filter(d => d.hoursLeft >= HOURS.TRANSFER)
        .sort((a, b) => b.hoursLeft - a.hoursLeft);

      if (availableDrivers.length === 0) break;

      for (const driver of availableDrivers) {
        // PRIORITÀ 1: SHUTTLE (se abbiamo cisterne piene)
        if (fullTanks > 0 && driver.hoursLeft >= HOURS.SHUTTLE) {
          fullTanks--;
          emptyTanks++;
          driver.hoursLeft -= HOURS.SHUTTLE;
          shuttleToday++;
          litersToday += LITERS_PER_TANK;
          madeProgress = true;
          break; // Ricomincia il loop per rivalutare
        }

        // PRIORITÀ 2: TRANSFER (se abbiamo rimorchi pieni e cisterne vuote)
        if (fullTrailers > 0 && emptyTanks > 0 && driver.hoursLeft >= HOURS.TRANSFER) {
          fullTrailers--;
          emptyTrailers++;
          emptyTanks--;
          fullTanks++;
          driver.hoursLeft -= HOURS.TRANSFER;
          transferToday++;
          madeProgress = true;
          break;
        }

        // PRIORITÀ 3: FULL_ROUND (fallback se abbiamo abbastanza ore)
        if (driver.hoursLeft >= HOURS.FULL_ROUND) {
          driver.hoursLeft -= HOURS.FULL_ROUND;
          fullRoundToday++;
          litersToday += LITERS_PER_TANK;
          madeProgress = true;
          break;
        }
      }
    }

    // Registra il piano del giorno
    const hoursUsedPerDriver = new Map<string, number>();
    for (const d of driversToday) {
      const state = driverStates.find(s => s.id === d.id);
      if (state) {
        hoursUsedPerDriver.set(d.id, d.maxHours - state.hoursLeft);
      }
    }

    dayPlans.push({
      date: `day-${day + 1}`,
      supplyTrips: supplyToday,
      transferTrips: transferToday,
      shuttleTrips: shuttleToday,
      fullRoundTrips: fullRoundToday,
      litersDelivered: litersToday,
      hoursUsedPerDriver,
      endState: {
        fullTrailers,
        emptyTrailers,
        fullTanks,
      },
    });

    totalLiters += litersToday;
    totalSupply += supplyToday;
    totalTransfer += transferToday;
    totalShuttle += shuttleToday;
    totalFullRound += fullRoundToday;
    if (litersToday > 0) daysWithDeliveries++;
  }

  return {
    totalLiters,
    dayPlans,
    breakdown: {
      supplyTrips: totalSupply,
      transferTrips: totalTransfer,
      shuttleTrips: totalShuttle,
      fullRoundTrips: totalFullRound,
    },
    daysWithDeliveries,
  };
}

// ============================================================================
// TEST
// ============================================================================

export function testV2() {
  const NUM_TRAILERS = 4;
  const NUM_VEHICLES = 3;

  console.log('=== TEST ALGORITMO V2 (ore driver individuali) ===\n');

  // Scenario: Marco 5gg + Giovanni 4gg
  const marco = { id: 'marco', maxHours: 9 };
  const giovanni = { id: 'giovanni', maxHours: 9 };

  const driversPerDay = [
    [marco, giovanni], // Giorno 1
    [marco, giovanni], // Giorno 2
    [marco, giovanni], // Giorno 3
    [marco, giovanni], // Giorno 4
    [marco],           // Giorno 5 (solo Marco)
  ];

  const result = calculateGlobalMaxV2(5, driversPerDay, NUM_TRAILERS, NUM_VEHICLES);

  console.log('Scenario: Marco 5gg + Giovanni 4gg');
  console.log(`Risultato: ${result.totalLiters.toLocaleString()}L`);
  console.log(`Breakdown: ${result.breakdown.supplyTrips} SUPPLY, ${result.breakdown.transferTrips} TRANSFER, ${result.breakdown.shuttleTrips} SHUTTLE, ${result.breakdown.fullRoundTrips} FULL_ROUND`);
  console.log('\nPiano giornaliero:');

  result.dayPlans.forEach((d, i) => {
    const drivers = driversPerDay[i].map(dr => dr.id).join('+');
    const hoursUsed = Array.from(d.hoursUsedPerDriver.entries())
      .map(([id, h]) => `${id}:${h}h`)
      .join(', ');
    console.log(`  Giorno ${i + 1} (${drivers}):`);
    console.log(`    SUPPLY=${d.supplyTrips}, TRANSFER=${d.transferTrips}, SHUTTLE=${d.shuttleTrips}, FULL_ROUND=${d.fullRoundTrips}`);
    console.log(`    Litri=${d.litersDelivered.toLocaleString()}L, Ore: ${hoursUsed}`);
    console.log(`    Fine: ${d.endState.fullTanks} cist.piene, ${d.endState.fullTrailers} rim.pieni`);
  });

  // Test crescita monotona
  console.log('\n=== TEST CRESCITA MONOTONA ===\n');
  console.log('| Giovanni disponibile | MAX Litri | Incremento |');
  console.log('|---------------------|-----------|------------|');

  const results: number[] = [];
  for (let giovanniDays = 0; giovanniDays <= 5; giovanniDays++) {
    const drivers = [];
    for (let day = 0; day < 5; day++) {
      const dayDrivers = [{ id: 'marco', maxHours: 9 }];
      if (day < giovanniDays) {
        dayDrivers.push({ id: 'giovanni', maxHours: 9 });
      }
      drivers.push(dayDrivers);
    }

    const r = calculateGlobalMaxV2(5, drivers, NUM_TRAILERS, NUM_VEHICLES);
    results.push(r.totalLiters);

    const increment = giovanniDays === 0 ? 'baseline' : `+${(r.totalLiters - results[giovanniDays - 1]).toLocaleString()}L`;
    console.log(`| ${giovanniDays} giorno/i            | ${r.totalLiters.toLocaleString().padStart(9)}L | ${increment.padStart(10)} |`);
  }

  // Verifica monotonia
  let monotonic = true;
  for (let i = 1; i < results.length; i++) {
    if (results[i] < results[i - 1]) {
      monotonic = false;
      console.log(`\n❌ ERRORE: ${i}gg (${results[i]}L) < ${i-1}gg (${results[i-1]}L)`);
    }
  }
  if (monotonic) {
    console.log('\n✅ Crescita monotona verificata!');
  }
}
