// ============================================================================
// ALGORITMO DI OTTIMIZZAZIONE GLOBALE V2
// ============================================================================
// Traccia le ore per ogni driver individualmente.
// I driver possono scambiarsi di posto quando si incontrano (risorse condivise).
// Supporta driver Tirano (SUPPLY, TRANSFER, SHUTTLE, FULL_ROUND) e Livigno (SHUTTLE + SUPPLY con eccezione ADR).
// ============================================================================

const HOURS = {
  SUPPLY: 6,
  SUPPLY_LIVIGNO: 10,  // Livigno→Tirano→Milano→Tirano→Livigno (richiede eccezione ADR)
  TRANSFER: 0.5,
  SHUTTLE: 4.5,
  FULL_ROUND: 9,
  // Nuovi tipi per driver Livigno con motrice dedicata che resta a Livigno
  SHUTTLE_FROM_LIVIGNO: 4.5,   // Livigno→Tirano→(transfer)→Livigno: 90+30+120+30=270min
  SUPPLY_FROM_LIVIGNO: 10,    // Livigno→Tirano→Milano→Tirano→Livigno: 600min (eccezione ADR)
};

const LITERS_PER_TANK = 17500;
const MAX_DRIVER_HOURS = 9;
const MAX_ADR_EXTENDED_PER_WEEK = 2; // ADR permette 10h max 2 volte/settimana

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
  livignoShuttles: number;
  livignoSupplyTrips: number;
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
    livignoShuttles: number;
    livignoSupplyTrips: number;
    // Nuovi contatori per driver Livigno con motrice dedicata
    shuttleFromLivigno: number;   // SHUTTLE_FROM_LIVIGNO
    supplyFromLivigno: number;    // SUPPLY_FROM_LIVIGNO
  };
  daysWithDeliveries: number;
}

/**
 * Calcola il MAX con tracciamento individuale delle ore driver.
 * Supporta driver Tirano e Livigno operanti in parallelo.
 *
 * @param numDays - Numero di giorni lavorativi
 * @param tiranoDriversPerDay - Array di array: per ogni giorno, lista di driver Tirano disponibili
 * @param livignoDriversPerDay - Array di array: per ogni giorno, lista di driver Livigno disponibili
 * @param numTrailers - Numero di rimorchi disponibili
 * @param numVehicles - Numero di motrici a Tirano
 * @param initialFullTrailers - Rimorchi pieni all'inizio
 * @param initialFullTanks - Cisterne piene all'inizio
 */
export function calculateGlobalMaxV2(
  numDays: number,
  tiranoDriversPerDay: { id: string; maxHours: number }[][],
  numTrailers: number,
  numVehicles: number,
  initialFullTrailers: number = 0,
  initialFullTanks: number = 0,
  livignoDriversPerDay: { id: string; maxHours: number }[][] = []
): GlobalResult {
  if (numDays === 0 || tiranoDriversPerDay.length === 0) {
    return {
      totalLiters: 0,
      dayPlans: [],
      breakdown: {
        supplyTrips: 0,
        transferTrips: 0,
        shuttleTrips: 0,
        fullRoundTrips: 0,
        livignoShuttles: 0,
        livignoSupplyTrips: 0,
        shuttleFromLivigno: 0,
        supplyFromLivigno: 0,
      },
      daysWithDeliveries: 0,
    };
  }

  // Stato risorse (condivise tra tutti i driver)
  let fullTrailers = initialFullTrailers;
  let emptyTrailers = numTrailers - initialFullTrailers;
  let fullTanks = initialFullTanks;
  let emptyTanks = numVehicles - initialFullTanks; // Motrici con cisterna vuota

  // Contatori totali
  let totalLiters = 0;
  let totalSupply = 0;
  let totalTransfer = 0;
  let totalShuttle = 0;
  let totalFullRound = 0;
  let totalLivignoShuttle = 0;
  let totalLivignoSupply = 0;
  let totalShuttleFromLivigno = 0;  // SHUTTLE_FROM_LIVIGNO
  let totalSupplyFromLivigno = 0;   // SUPPLY_FROM_LIVIGNO
  let daysWithDeliveries = 0;

  // Traccia eccezioni ADR usate per driver Livigno (max 2/settimana)
  const livignoAdrExceptions = new Map<string, number>();

  const dayPlans: DayPlan[] = [];

  for (let day = 0; day < numDays; day++) {
    const tiranoDriversToday = tiranoDriversPerDay[day] || [];
    const livignoDriversToday = livignoDriversPerDay[day] || [];
    const remainingDays = numDays - day;
    const isLastDay = remainingDays === 1;

    // Reset eccezioni ADR ogni 5 giorni (nuova settimana lavorativa)
    if (day > 0 && day % 5 === 0) {
      livignoAdrExceptions.clear();
    }

    // Stato driver Tirano per oggi
    const tiranoDriverStates: DriverState[] = tiranoDriversToday.map(d => ({
      id: d.id,
      hoursLeft: d.maxHours,
    }));

    // Stato driver Livigno per oggi
    const livignoDriverStates: DriverState[] = livignoDriversToday.map(d => ({
      id: d.id,
      hoursLeft: d.maxHours,
    }));

    let litersToday = 0;
    let supplyToday = 0;
    let transferToday = 0;
    let shuttleToday = 0;
    let fullRoundToday = 0;
    let livignoShuttleToday = 0;
    let livignoSupplyToday = 0;
    let shuttleFromLivignoToday = 0;
    let supplyFromLivignoToday = 0;

    // Risorse che arriveranno dopo i SUPPLY (a metà giornata)
    let pendingFullTrailers = 0;
    let pendingFullTanks = 0;

    // =========================================================================
    // FASE 1: SUPPLY (primi trip della giornata)
    // Driver Tirano: SUPPLY standard (6h)
    // Driver Livigno: SUPPLY con eccezione ADR (10h, max 2/settimana)
    // =========================================================================
    let suppliesDone = 0;

    if (!isLastDay) {
      // Calcola quanti SUPPLY servono (considerando sia Tirano che Livigno)
      const tomorrowTiranoDrivers = tiranoDriversPerDay[day + 1] || [];
      const tomorrowLivignoDrivers = livignoDriversPerDay[day + 1] || [];
      const tomorrowTiranoHours = tomorrowTiranoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
      const tomorrowLivignoHours = tomorrowLivignoDrivers.reduce((sum, d) => sum + d.maxHours, 0);
      const tomorrowShuttlePotential = Math.floor(tomorrowTiranoHours / HOURS.SHUTTLE) +
                                       Math.floor(tomorrowLivignoHours / HOURS.SHUTTLE);

      const currentResources = fullTanks + fullTrailers + pendingFullTanks + pendingFullTrailers;
      const resourcesNeeded = Math.max(0, tomorrowShuttlePotential - currentResources);
      const suppliesWanted = Math.ceil(resourcesNeeded / 2);

      // Prima: fai SUPPLY con i driver Tirano che hanno tempo (più efficiente, 6h)
      for (const driver of tiranoDriverStates) {
        if (suppliesDone >= suppliesWanted) break;
        if (driver.hoursLeft < HOURS.SUPPLY) continue;
        if (emptyTrailers <= 0) break;
        if (emptyTanks <= 0) break;

        driver.hoursLeft -= HOURS.SUPPLY;
        emptyTrailers--;
        emptyTanks--;
        pendingFullTrailers++;
        pendingFullTanks++;
        supplyToday++;
        suppliesDone++;
      }

      // Poi: se servono ancora SUPPLY, usa driver Livigno con eccezione ADR (10h)
      // L'eccezione ADR permette di estendere da 9h a 10h, max 2 volte/settimana
      if (suppliesDone < suppliesWanted) {
        for (const driver of livignoDriverStates) {
          if (suppliesDone >= suppliesWanted) break;
          // Il driver deve avere tutte le sue ore disponibili (giornata piena)
          if (driver.hoursLeft < MAX_DRIVER_HOURS) continue;
          if (emptyTrailers <= 0) break;
          if (emptyTanks <= 0) break;

          // Verifica limite eccezioni ADR (max 2/settimana)
          const usedExceptions = livignoAdrExceptions.get(driver.id) || 0;
          if (usedExceptions >= MAX_ADR_EXTENDED_PER_WEEK) continue;

          // Usa l'eccezione ADR: estende da 9h a 10h
          driver.hoursLeft = 0; // Consuma tutta la giornata
          livignoAdrExceptions.set(driver.id, usedExceptions + 1);
          emptyTrailers--;
          emptyTanks--;
          pendingFullTrailers++;
          pendingFullTanks++;
          livignoSupplyToday++;
          suppliesDone++;
        }
      }
    }

    // =========================================================================
    // FASE 2: Le risorse SUPPLY arrivano
    // =========================================================================
    fullTrailers += pendingFullTrailers;
    fullTanks += pendingFullTanks;
    emptyTanks += suppliesDone; // Le motrici tornano (con cisterna piena)
    pendingFullTrailers = 0;
    pendingFullTanks = 0;

    // =========================================================================
    // FASE 3: SHUTTLE e TRANSFER (driver Tirano e Livigno in parallelo)
    // =========================================================================
    // NOTA: Questa simulazione non distingue tra driver Livigno con motrice
    // a Tirano vs a Livigno. Per il calcolo MAX, assumiamo che i driver Livigno
    // possano usare sia SHUTTLE standard (motrice a Tirano) che SHUTTLE_FROM_LIVIGNO
    // (motrice a Livigno che consuma rimorchi pieni).
    // =========================================================================
    let madeProgress = true;
    let iterations = 0;
    const maxIterations = 100;

    while (madeProgress && iterations < maxIterations) {
      madeProgress = false;
      iterations++;

      // Prima i driver Livigno
      const availableLivignoDrivers = livignoDriverStates
        .filter(d => d.hoursLeft >= Math.min(HOURS.SHUTTLE, HOURS.SHUTTLE_FROM_LIVIGNO))
        .sort((a, b) => b.hoursLeft - a.hoursLeft);

      for (const driver of availableLivignoDrivers) {
        // PRIORITÀ 1: SHUTTLE standard (motrice piena a Tirano)
        if (fullTanks > 0 && driver.hoursLeft >= HOURS.SHUTTLE) {
          fullTanks--;
          emptyTanks++; // La motrice torna vuota a Tirano
          driver.hoursLeft -= HOURS.SHUTTLE;
          livignoShuttleToday++;
          litersToday += LITERS_PER_TANK;
          madeProgress = true;
          break;
        }

        // PRIORITÀ 2: SHUTTLE_FROM_LIVIGNO (motrice a Livigno, consuma rimorchio pieno)
        // Questo simula un driver Livigno con motrice dedicata che resta a Livigno
        if (fullTrailers > 0 && driver.hoursLeft >= HOURS.SHUTTLE_FROM_LIVIGNO) {
          fullTrailers--;
          emptyTrailers++; // Il rimorchio torna vuoto a Tirano
          driver.hoursLeft -= HOURS.SHUTTLE_FROM_LIVIGNO;
          shuttleFromLivignoToday++;
          litersToday += LITERS_PER_TANK;
          madeProgress = true;
          break;
        }

        // PRIORITÀ 3: SUPPLY_FROM_LIVIGNO (se nessuna risorsa disponibile)
        // Richiede eccezione ADR e giornata piena
        if (emptyTrailers > 0 && driver.hoursLeft >= HOURS.SUPPLY_FROM_LIVIGNO) {
          const usedExceptions = livignoAdrExceptions.get(driver.id) || 0;
          if (usedExceptions < MAX_ADR_EXTENDED_PER_WEEK) {
            emptyTrailers--;
            // Il rimorchio torna pieno, ma la motrice resta a Livigno
            pendingFullTrailers++;
            driver.hoursLeft = 0; // Consuma tutta la giornata
            livignoAdrExceptions.set(driver.id, usedExceptions + 1);
            supplyFromLivignoToday++;
            litersToday += LITERS_PER_TANK; // Consegna 17.500L a Livigno
            madeProgress = true;
            break;
          }
        }
      }

      if (madeProgress) continue;

      // Poi driver Tirano: SHUTTLE, TRANSFER, FULL_ROUND
      const availableTiranoDrivers = tiranoDriverStates
        .filter(d => d.hoursLeft >= HOURS.TRANSFER)
        .sort((a, b) => b.hoursLeft - a.hoursLeft);

      if (availableTiranoDrivers.length === 0) break;

      for (const driver of availableTiranoDrivers) {
        // PRIORITÀ 1: SHUTTLE
        if (fullTanks > 0 && driver.hoursLeft >= HOURS.SHUTTLE) {
          fullTanks--;
          emptyTanks++;
          driver.hoursLeft -= HOURS.SHUTTLE;
          shuttleToday++;
          litersToday += LITERS_PER_TANK;
          madeProgress = true;
          break;
        }

        // PRIORITÀ 2: TRANSFER
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

        // PRIORITÀ 3: FULL_ROUND
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
    for (const d of tiranoDriversToday) {
      const state = tiranoDriverStates.find(s => s.id === d.id);
      if (state) {
        hoursUsedPerDriver.set(d.id, d.maxHours - state.hoursLeft);
      }
    }
    for (const d of livignoDriversToday) {
      const state = livignoDriverStates.find(s => s.id === d.id);
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
      livignoShuttles: livignoShuttleToday,
      livignoSupplyTrips: livignoSupplyToday,
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
    totalLivignoShuttle += livignoShuttleToday;
    totalLivignoSupply += livignoSupplyToday;
    totalShuttleFromLivigno += shuttleFromLivignoToday;
    totalSupplyFromLivigno += supplyFromLivignoToday;
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
      livignoShuttles: totalLivignoShuttle,
      livignoSupplyTrips: totalLivignoSupply,
      shuttleFromLivigno: totalShuttleFromLivigno,
      supplyFromLivigno: totalSupplyFromLivigno,
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

  // Scenario base: 2 driver Tirano (Luca, Paolo) per 5 giorni
  const luca = { id: 'luca', maxHours: 9 };
  const paolo = { id: 'paolo', maxHours: 9 };

  const tiranoDriversPerDay = [
    [luca, paolo], // Giorno 1
    [luca, paolo], // Giorno 2
    [luca, paolo], // Giorno 3
    [luca, paolo], // Giorno 4
    [luca, paolo], // Giorno 5
  ];

  console.log('--- SCENARIO 1: Solo driver Tirano (2 driver x 5 giorni) ---');
  const result1 = calculateGlobalMaxV2(5, tiranoDriversPerDay, NUM_TRAILERS, NUM_VEHICLES);

  console.log(`Risultato: ${result1.totalLiters.toLocaleString()}L`);
  console.log(`Breakdown: ${result1.breakdown.supplyTrips} SUPPLY Tirano, ${result1.breakdown.livignoSupplyTrips} SUPPLY Livigno, ${result1.breakdown.transferTrips} TRANSFER, ${result1.breakdown.shuttleTrips} SHUTTLE Tirano, ${result1.breakdown.livignoShuttles} SHUTTLE Livigno, ${result1.breakdown.fullRoundTrips} FULL_ROUND`);

  // Scenario con driver Livigno
  console.log('\n--- SCENARIO 2: Tirano (2) + Livigno (1) x 5 giorni ---');
  const marco = { id: 'marco-livigno', maxHours: 9 };

  const livignoDriversPerDay = [
    [marco], // Giorno 1
    [marco], // Giorno 2
    [marco], // Giorno 3
    [marco], // Giorno 4
    [marco], // Giorno 5
  ];

  const result2 = calculateGlobalMaxV2(5, tiranoDriversPerDay, NUM_TRAILERS, NUM_VEHICLES, 0, 0, livignoDriversPerDay);

  console.log(`Risultato: ${result2.totalLiters.toLocaleString()}L`);
  console.log(`Breakdown: ${result2.breakdown.supplyTrips} SUPPLY Tirano, ${result2.breakdown.livignoSupplyTrips} SUPPLY Livigno, ${result2.breakdown.transferTrips} TRANSFER, ${result2.breakdown.shuttleTrips} SHUTTLE Tirano, ${result2.breakdown.livignoShuttles} SHUTTLE Livigno, ${result2.breakdown.fullRoundTrips} FULL_ROUND`);

  const incremento = result2.totalLiters - result1.totalLiters;
  console.log(`\nIncremento da driver Livigno: +${incremento.toLocaleString()}L`);

  // Scenario 3: Solo driver Livigno (test SUPPLY con eccezione ADR)
  console.log('\n--- SCENARIO 3: Solo Livigno (1 driver x 5 giorni) - verifica SUPPLY ADR ---');
  const soloLivignoTirano: { id: string; maxHours: number }[][] = [[], [], [], [], []]; // Nessun driver Tirano

  const result3 = calculateGlobalMaxV2(5, soloLivignoTirano, NUM_TRAILERS, NUM_VEHICLES, 0, 0, livignoDriversPerDay);

  console.log(`Risultato: ${result3.totalLiters.toLocaleString()}L`);
  console.log(`Breakdown: ${result3.breakdown.supplyTrips} SUPPLY Tirano, ${result3.breakdown.livignoSupplyTrips} SUPPLY Livigno (ADR), ${result3.breakdown.livignoShuttles} SHUTTLE Livigno`);
  console.log(`Note: Marco può fare max 2 SUPPLY/settimana con eccezione ADR (10h)`);

  // Piano giornaliero
  console.log(`\nPiano giornaliero con driver Livigno:`);
  result2.dayPlans.forEach((d, i) => {
    console.log(`  Giorno ${i + 1}: SUPPLY Tirano=${d.supplyTrips}, SUPPLY Livigno=${d.livignoSupplyTrips}, SHUTTLE Tirano=${d.shuttleTrips}, SHUTTLE Livigno=${d.livignoShuttles}`);
    console.log(`    Litri=${d.litersDelivered.toLocaleString()}L | Risorse fine: ${d.endState.fullTanks} cist.piene, ${d.endState.fullTrailers} rim.pieni`);
  });

  // Test crescita monotona con driver Livigno
  console.log('\n=== TEST CRESCITA MONOTONA (con Livigno) ===\n');
  console.log('| Marco (Livigno) disponibile | MAX Litri | Incremento |');
  console.log('|-----------------------------|-----------|------------|');

  const results: number[] = [];
  for (let marcoDays = 0; marcoDays <= 5; marcoDays++) {
    const livignoDrivers = [];
    for (let day = 0; day < 5; day++) {
      if (day < marcoDays) {
        livignoDrivers.push([{ id: 'marco', maxHours: 9 }]);
      } else {
        livignoDrivers.push([]);
      }
    }

    const r = calculateGlobalMaxV2(5, tiranoDriversPerDay, NUM_TRAILERS, NUM_VEHICLES, 0, 0, livignoDrivers);
    results.push(r.totalLiters);

    const increment = marcoDays === 0 ? 'baseline' : `+${(r.totalLiters - results[marcoDays - 1]).toLocaleString()}L`;
    console.log(`| ${marcoDays} giorno/i                    | ${r.totalLiters.toLocaleString().padStart(9)}L | ${increment.padStart(10)} |`);
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
