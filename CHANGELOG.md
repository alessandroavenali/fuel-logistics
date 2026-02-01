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
