# Changelog

## [Unreleased]

### Added - Viaggi Driver Livigno con Motrice Dedicata

Implementati due nuovi tipi di viaggio per driver di Livigno che hanno una motrice dedicata che **resta a Livigno** dopo ogni viaggio.

#### Nuovi Tipi di Viaggio

##### `SHUTTLE_FROM_LIVIGNO` (4.5h)
Scenario: Rimorchi pieni disponibili a Tirano

| Fase | Azione | Durata |
|------|--------|--------|
| 1 | Partenza da Livigno (motrice vuota) | - |
| 2 | Livigno → Tirano | 90 min |
| 3 | TRANSFER: rimorchio pieno → cisterna integrata | 30 min |
| 4 | Tirano → Livigno (motrice piena) | 120 min |
| 5 | Scarico a Livigno | 30 min |
| **Totale** | | **270 min (4.5h)** |

- **Consuma**: 1 rimorchio pieno a Tirano (diventa vuoto)
- **Produce**: 1 rimorchio vuoto a Tirano
- **Consegna**: 17.500L a Livigno
- **Motrice**: resta a Livigno (vuota) - pronta per un altro viaggio

**Capacità giornaliera**: Un driver Livigno può fare **2x SHUTTLE_FROM_LIVIGNO** in 9h = **35.000L/giorno**

##### `SUPPLY_FROM_LIVIGNO` (10h - richiede eccezione ADR)
Scenario: Rimorchi vuoti a Tirano, serve rifornimento

| Fase | Azione | Durata |
|------|--------|--------|
| 1 | Partenza da Livigno (motrice vuota) | - |
| 2 | Livigno → Tirano | 90 min |
| 3 | Aggancio rimorchio vuoto | - |
| 4 | Tirano → Milano | 150 min |
| 5 | Carico (motrice + rimorchio) | 60 min |
| 6 | Milano → Tirano | 150 min |
| 7 | Sgancio rimorchio PIENO a Tirano | - |
| 8 | Tirano → Livigno (motrice piena) | 120 min |
| 9 | Scarico a Livigno | 30 min |
| **Totale** | | **600 min (10h)** |

- **Consuma**: 1 rimorchio vuoto a Tirano
- **Produce**: 1 rimorchio pieno a Tirano
- **Consegna**: 17.500L a Livigno
- **Motrice**: resta a Livigno (vuota)
- **Nota**: Richiede eccezione ADR (max 2 volte/settimana per driver)

#### Logica Decisionale Optimizer

Per un driver Livigno con motrice a Livigno:

1. Se rimorchi PIENI a Tirano >= 1 && ore disponibili >= 4.5h:
   → `SHUTTLE_FROM_LIVIGNO`

2. Altrimenti, se rimorchi VUOTI a Tirano >= 1 && ore disponibili >= 10h && eccezione ADR disponibile:
   → `SUPPLY_FROM_LIVIGNO`

3. Altrimenti:
   → Attendi rimorchi pieni o fine giornata

#### File Modificati

**Backend**:
- `prisma/schema.prisma` - Aggiunto enum values `SHUTTLE_FROM_LIVIGNO`, `SUPPLY_FROM_LIVIGNO`
- `src/services/optimizer.service.ts` - Logica decisionale e handler esecuzione
- `src/services/optimizer-global-v2.service.ts` - Calcolo MAX con nuovi tipi

**Frontend**:
- `src/types/index.ts` - Aggiornato tipo `TripType`
- `src/pages/ScheduleDetail.tsx` - Badge, timeline e calcolo litri
- `src/components/calendar/DriverTimeline.tsx` - Colori e legenda

#### UI

- **SHUTTLE_FROM_LIVIGNO**: Badge e barra colore **cyan**
- **SUPPLY_FROM_LIVIGNO**: Badge e barra colore **pink**

Legenda aggiornata con "Shuttle LIV" e "Supply LIV".

### Fixed - Debug Session 2026-02-01

#### Frontend
- **ScheduleDetail.tsx**: Il calcolo litri nel pannello dettaglio viaggio ora include `SHUTTLE_FROM_LIVIGNO` e `SUPPLY_FROM_LIVIGNO` (prima mostrava 0L invece di 17.500L)

#### Backend - calculateMaxCapacity
- Traccia separatamente motrici a Tirano vs Livigno
- `shuttleFromLivigno` e `supplyFromLivigno` nel breakdown ora vengono popolati correttamente (prima erano sempre 0)
- Aggiunta logica per driver Livigno con motrice dedicata a Livigno

#### Backend - optimizeSchedule
- **totalLiters** ora conta solo i litri effettivamente consegnati a Livigno
- Prima contava tutti i litri movimentati (inclusi SUPPLY_MILANO e TRANSFER_TIRANO che non consegnano)

### Fixed - Allocazione Driver Ottimizzata (2026-02-01)

#### Problema Risolto
L'optimizer era "greedy": usava tutti i driver per massimizzare le consegne del giorno corrente, anche quando alcuni driver sarebbero stati più utili a fare SUPPLY per preparare rimorchi per il giorno dopo.

**Esempio prima del fix**: Con 4 rimorchi pieni e 3 driver (Marco Livigno, Luca e Paolo Tirano), Paolo faceva TRANSFER inutile invece di SUPPLY.

#### Soluzione Implementata

**1. Pre-fase: Calcolo Driver in Eccesso**
All'inizio di ogni giornata, l'optimizer calcola:
- Quanti rimorchi pieni possono consumare i driver Livigno (con SHUTTLE_FROM_LIVIGNO)
- Quanti rimorchi restano per i driver Tirano
- Quanti driver Tirano servono (ogni driver fa ~2 cicli TRANSFER+SHUTTLE/giorno)
- I driver Tirano "in eccesso" vengono marcati per fare SUPPLY

**2. Logica Decisionale Modificata**
I driver in eccesso:
- Priorità assoluta a SUPPLY (se ci sono rimorchi vuoti)
- Se non ci sono rimorchi vuoti, aspettano che diventino disponibili
- NON possono fare TRANSFER (rimorchi pieni riservati agli altri driver)

**3. Tracking Temporale Preciso dei Rimorchi Vuoti**
Aggiunta mappa `trailerEmptyAvailableAt` che traccia quando i rimorchi diventeranno vuoti:
- **TRANSFER_TIRANO**: rimorchio vuoto al `returnTime` (dopo 30 min)
- **SHUTTLE_FROM_LIVIGNO**: rimorchio vuoto dopo Livigno→Tirano + TRANSFER (dopo 120 min)

I driver in eccesso aspettano il momento esatto in cui il primo rimorchio diventa vuoto.

#### Esempio Flusso Corretto

| Tempo | Marco (Livigno) | Luca (Tirano) | Paolo (excess) |
|-------|-----------------|---------------|----------------|
| 06:00 | SHUTTLE_FROM_LIVIGNO | TRANSFER | _aspetta_ |
| 06:30 | ... | SHUTTLE | **SUPPLY** (rimorchio vuoto!) |
| 10:30 | SHUTTLE #2 | TRANSFER #2 | ... |
| 12:30 | ... | SHUTTLE #2 | SUPPLY finito |

**Risultato**: Paolo fa SUPPLY alle 06:30 (appena il rimorchio di Luca diventa vuoto), preparando risorse per il giorno dopo.

### Fixed - Bug SUPPLY_FROM_LIVIGNO (2026-02-01)

#### Problema
`SUPPLY_FROM_LIVIGNO` non veniva mai eseguito in `calculateMaxCapacity`.

#### Causa
Condizione errata: `hoursLeft >= HOURS_SUPPLY_FROM_LIVIGNO` (10h)
Ma i driver hanno `MAX_DAILY_HOURS = 9h`, quindi la condizione era sempre FALSE.

#### Fix
Cambiato in: `hoursLeft >= MAX_DAILY_HOURS` (9h)
L'eccezione ADR estende automaticamente a 10h quando necessario.

### Added - Test Suite Ottimizzazione (2026-02-01)

Creati test completi per verificare `calculateMaxCapacity` e `optimizeSchedule`:

```
backend/src/tests/
├── optimizer-allocation.test.ts  # 7 scenari
└── optimizer-trips.test.ts       # Generazione trip
```

#### Scenari Testati

| # | Scenario | MAX Atteso | Verifica |
|---|----------|------------|----------|
| 1 | Baseline (3 RESIDENT, 4 pieni) | 70.000L | ✅ |
| 2 | Più driver che rimorchi | 35.000L | ✅ |
| 3 | Solo driver Tirano | 70.000L | ✅ |
| 4 | Multi-giorno carry-over | 157.500L | ✅ |
| 5 | ON_CALL parziale | 87.500L | ✅ |
| 6 | 0 rimorchi pieni | 17.500L | ✅ |
| 7 | Limite motrici Livigno | 70.000L | ✅ |

### Documented - Limitazioni Algoritmo

Documentate nel README le limitazioni note dell'algoritmo:

1. **FULL_ROUND non eseguibile**: richiede 9.5h ma ADR limit è 9h
2. **No combo SUPPLY+SHUTTLE**: 6h + 4h = 10h supera limite
3. **Eccezione ADR solo per Livigno**: non implementata per FULL_ROUND o combo Tirano
4. **No chaining intra-giornaliero**: tracking risorse a fine giornata
