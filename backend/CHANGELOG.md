# Changelog

## [Unreleased]

### Changed
- **Calendario colorato per tipo viaggio**: i blocchi nel calendario ora hanno colori distinti per tipo
  - Verde: Shuttle (Tirano ↔ Livigno)
  - Blu: Supply (rifornimento Milano)
  - Viola: Completo (giro completo)
  - Arancione: Transfer (sversamento)
  - Rosso: Annullato
  - Legenda aggiornata di conseguenza
- **Calendario più compatto**: ridotto HOUR_WIDTH (50px), range orario 6-21, colonna autisti più stretta per evitare scroll orizzontale

### Fixed
- **Durate viaggi calcolate dinamicamente dal DB**: le durate SHUTTLE, SUPPLY, FULL_ROUND ora vengono calcolate dalle rotte nel database invece di essere hardcoded
  - Aggiunta funzione `getRouteDurations()` che legge le rotte dal DB
  - Aggiunta funzione `calculateTripDurations()` che calcola le durate corrette
  - **SHUTTLE**: corretto da 270 min (4.5h) a 240 min (4h) - era sbagliato il ritorno Livigno→Tirano (90 min, non 120)
  - **SUPPLY_LIVIGNO**: corretto da 600 min (10h) a 570 min (9.5h)
  - **FULL_ROUND**: corretto da 540 min (9h) a 570 min (9.5h)
  - SUPPLY da Tirano (360 min / 6h) era già corretto
  - Tempi carico distinti: 60 min per SUPPLY (35.000L), 30 min per FULL_ROUND (17.500L)

### Added
- **Driver Livigno nel calcolo MAX**: implementato supporto completo per driver basati a Livigno
  - I driver Livigno operano in parallelo con i driver Tirano
  - Possono fare SHUTTLE "inverso": Livigno→Tirano→Livigno (4.5h), consumando cisterne piene a Tirano
  - Possono fare SUPPLY con eccezione ADR (10h, max 2 volte/settimana per driver)
    - L'algoritmo decide automaticamente quando conviene usare l'eccezione
    - Prima usa i driver Tirano (SUPPLY 6h più efficiente), poi Livigno se servono risorse
  - NON possono fare TRANSFER (non sono fisicamente a Tirano)
  - Max 2 SHUTTLE/giorno per driver Livigno (9h / 4.5h)
  - Con 1 driver Livigno (Marco) + 2 driver Tirano, il MAX aumenta di ~70.000L/5 giorni
  - Nuovi campi nel breakdown: `livignoDriverShuttles`, `livignoSupplyTrips`

### Fixed
- **Algoritmo ottimizzazione globale V2**: riscritto completamente `calculateMaxCapacity` per risolvere il problema della non-scalabilità con driver aggiuntivi
  - L'algoritmo greedy decideva giorno per giorno e non sfruttava correttamente le ore driver
  - Ora traccia le ore per ogni driver individualmente (requisito ADR)
  - I driver possono scambiarsi di posto quando si incontrano (risorse condivise, come nella realtà)
  - Separa le fasi: SUPPLY mattina → risorse disponibili → SHUTTLE/TRANSFER pomeriggio
  - Garantisce crescita monotona: aggiungere giorni-driver non peggiora MAI il risultato
  - Giovanni 4gg ora produce 157.500L (prima 140.000L con algoritmo errato)

### Changed
- **Modello risorse più realistico**: le motrici e rimorchi sono condivisi tra driver, ma ogni driver ha il suo budget ore ADR individuale
- **Fasi di scheduling**: i SUPPLY vengono fatti per primi (mattina), le risorse create diventano disponibili per SHUTTLE nel pomeriggio dello stesso giorno

### Added
- `optimizer-global-v2.service.ts`: versione standalone dell'algoritmo per test e debug

---

## [Previous - Pre-Global-Optimizer]

### Fixed
- **Driver Livigno non usavano motrice locale**: i driver di Livigno ora cercano prima motrici nella loro stessa location per SUPPLY, permettendo di usare la Motrice Alfa (base Livigno) che prima restava inutilizzata
- **Aggiungere driver opzionali poteva diminuire MAX**: corretto bug dove aggiungere giorni a driver ON_CALL/EMERGENCY causava un effetto cascata negativo (troppi SUPPLY → troppi TRANSFER → meno SHUTTLE)
- **Garantita monotonia del calcolo MAX**: `calculateMaxCapacity` ora confronta il risultato con tutti i driver vs solo RESIDENT (baseline) e usa automaticamente il migliore, garantendo che aggiungere driver non peggiori mai il risultato

### Changed
- **Limite SUPPLY bilanciato**: aggiunto limite dinamico per evitare accumulo eccessivo di rimorchi pieni che non possono essere smaltiti nei giorni successivi
- **Posizione motrice dopo SUPPLY**: le motrici che partono da Livigno per SUPPLY tornano sempre a Tirano, rendendole disponibili per SHUTTLE successivi

### Added
- **Verifica scenari multipli**: testati 8 scenari diversi con disponibilità driver variabili per validare correttezza algoritmo

---

## [Previous]

### Fixed
- **Calcolo MAX capacità**: `dailyCapacity` ora divide per i giorni con consegne effettive invece che per tutti i giorni lavorativi del periodo
- **Invalidazione risultato MAX**: il frontend ora resetta il risultato quando cambiano disponibilità autisti, date, stato cisterne o flag weekend
- **Limiti arbitrari rimossi**: eliminati i limiti hardcoded `totalFullExpected < 4` e `suppliesInProgress < 2` che limitavano la capacità massima

### Changed
- **Bilanciamento SHUTTLE/SUPPLY ottimale**: l'ottimizzatore ora bilancia automaticamente SHUTTLE e SUPPLY per massimizzare sia i litri a Livigno che le cisterne piene a Tirano
  - Obiettivo primario: massimizzare litri consegnati a Livigno
  - Obiettivo secondario: a parità di Livigno, massimizzare cisterne piene a Tirano
  - Se ci sono più driver disponibili che cisterne piene, i driver "extra" fanno SUPPLY invece di aspettare
  - Non si aspetta MAI se si può fare SUPPLY
  - Esempio: 4 piene + 4 driver + 2 vuote → 3 SHUTTLE + 1 SUPPLY invece di 4 SHUTTLE
  - Risultato: stesso throughput a Livigno + cisterne pronte per il giorno dopo
- **Logica ottimizzatore unificata**: tutti i driver (Livigno e Tirano) possono fare sia SHUTTLE che SUPPLY
- **Priorità viaggi aggiornata**:
  1. Cisterne piene + nessun bisogno di bilanciare → SHUTTLE
  2. Cisterne vuote disponibili + driver in eccesso → SUPPLY (bilanciamento)
  3. Cisterne piene (fallback se no vuote per SUPPLY) → SHUTTLE
  4. Cisterne in arrivo da SUPPLY → Aspetta (solo se non può fare altro)
  5. Fallback → FULL_ROUND
- **Durata SUPPLY variabile per base driver**:
  - Driver Tirano: 6h (percorso diretto)
  - Driver Livigno: 9h (include Livigno↔Tirano)

### Added
- Campo `daysWithDeliveries` nel risultato di `calculateMaxCapacity` per mostrare i giorni effettivi con consegne
- Visualizzazione nel frontend dei giorni con autisti disponibili vs giorni lavorativi totali
- Logica di bilanciamento: calcola `driversAvailableNow` e `shouldBalanceWithSupply` per decidere la strategia ottimale
