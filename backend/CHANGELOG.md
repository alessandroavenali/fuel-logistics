# Changelog

## [Unreleased]

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
