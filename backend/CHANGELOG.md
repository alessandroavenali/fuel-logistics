# Changelog

## [Unreleased]

### Fixed
- **Calcolo MAX capacità**: `dailyCapacity` ora divide per i giorni con consegne effettive invece che per tutti i giorni lavorativi del periodo
- **Invalidazione risultato MAX**: il frontend ora resetta il risultato quando cambiano disponibilità autisti, date, stato cisterne o flag weekend
- **Limiti arbitrari rimossi**: eliminati i limiti hardcoded `totalFullExpected < 4` e `suppliesInProgress < 2` che limitavano la capacità massima

### Changed
- **Logica ottimizzatore unificata**: tutti i driver (Livigno e Tirano) possono fare sia SHUTTLE che SUPPLY
- **Priorità viaggi semplificata**:
  1. Cisterne piene disponibili → SHUTTLE (consegna immediata)
  2. Cisterne in arrivo da SUPPLY → Aspetta
  3. Solo cisterne vuote → SUPPLY
  4. Fallback → FULL_ROUND
- **Durata SUPPLY variabile per base driver**:
  - Driver Tirano: 6h (percorso diretto)
  - Driver Livigno: 9h (include Livigno↔Tirano)

### Added
- Campo `daysWithDeliveries` nel risultato di `calculateMaxCapacity` per mostrare i giorni effettivi con consegne
- Visualizzazione nel frontend dei giorni con autisti disponibili vs giorni lavorativi totali
