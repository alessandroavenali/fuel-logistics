# Fuel Logistics - Project Notes

## Stato del Progetto

Sistema di ottimizzazione logistica per trasporto carburante Milano → Tirano → Livigno.

### Ambiente di Produzione

- **URL**: http://46.224.126.189:8088
- **Server**: flipr-nue (Ubuntu 24.04)
- **Stack**: Docker (PostgreSQL + Node.js backend + nginx frontend)

### Database Corrente

| Entità | Quantità | Note |
|--------|----------|------|
| Locations | 3 | Milano (SOURCE), Tirano (PARKING), Livigno (DESTINATION) |
| Vehicles | 4 | Motrici con serbatoio integrato 17.500L. FG001AA base Livigno, altri base Tirano |
| Trailers | 4 | Rimorchi 17.500L, tutti base Tirano |
| Drivers | 5 | 1 Livigno (Marco Bianchi), 4 Tirano |
| Routes | 4 | Tirano→Livigno: 120min (salita), Livigno→Tirano: 90min (discesa), Milano↔Tirano: 150min |

### Modello Logistico

- **Motrici**: hanno serbatoio integrato da 17.500L (non staccabile)
- **Rimorchi**: serbatoi aggiuntivi da 17.500L trainabili dalle motrici
- **Capacità totale per viaggio**: motrice (17.500L) + rimorchio (17.500L) = 35.000L

### Terminologia

| Termine | Significato |
|---------|-------------|
| **Serbatoio integrato** | Tank fisso nella motrice (17.500L, non staccabile) |
| **Rimorchio** | Trailer con serbatoio aggiuntivo (17.500L, trainabile) |
| **Motrice** | Veicolo con serbatoio integrato, può trainare 1-2 rimorchi |

**Nota**: Il campo DB `adrCisternExpiry` mantiene il nome originale (certificazione ADR cisterne).

## Workflow di Sviluppo

### CI/CD Automatico

```
git push origin main  →  GitHub Actions  →  Deploy automatico su flipr-nue
```

Il workflow `.github/workflows/deploy.yml`:
1. Si connette via SSH al server
2. Esegue `git pull`
3. Ricostruisce i container Docker
4. Applica le migrazioni Prisma

### Comandi Utili

**Locale:**
```bash
# Avviare backend (porta 3002)
cd backend && npm run dev

# Avviare frontend (porta 5173)
cd frontend && npm run dev

# Creare migrazione Prisma
cd backend && npx prisma migrate dev --name <nome_migrazione>

# Eseguire seed locale
cd backend && npm run db:seed
```

**Remoto (via SSH):**
```bash
ssh root@46.224.126.189

# Controllare stato container
cd ~/fuel-logistics && docker compose ps

# Vedere log
docker compose logs -f

# Eseguire seed manuale
docker compose exec -T backend npx tsx prisma/seed.ts

# Riavviare servizi
docker compose restart

# Rebuild forzato
docker compose build --no-cache && docker compose up -d
```

**Deploy manuale da GitHub:**
- Vai su https://github.com/alessandroavenali/fuel-logistics/actions
- Clicca "Run workflow" su "Deploy to Production"

### GitHub Secrets Configurati

| Secret | Descrizione |
|--------|-------------|
| `SERVER_HOST` | 46.224.126.189 |
| `SERVER_USER` | root |
| `SSH_PRIVATE_KEY` | Chiave SSH dedicata (~/.ssh/github_deploy_fuel) |

## Note Tecniche

### Prisma

- Schema: `backend/prisma/schema.prisma`
- Seed: `backend/prisma/seed.ts`
- Il seed **cancella tutti i dati** prima di ripopolare (usare con cautela in produzione)

**Migrazioni DB** (quando modifichi `schema.prisma`):
```bash
# 1. In locale: crea la migrazione
cd backend && npx prisma migrate dev --name <nome_descrittivo>

# 2. Commit dei file generati
git add prisma/migrations/
git commit -m "db: Add migration <nome>"
git push origin main

# 3. CI/CD applica automaticamente la migrazione
```

**IMPORTANTE**: Il CI/CD usa solo `migrate deploy`. Se lo schema non è allineato, il deploy fallisce.

**Perché può fallire?**
- Schema modificato in `schema.prisma` senza creare migrazione
- Il codice si aspetta colonne/tabelle che il DB non ha
- Prisma non trova la migrazione corrispondente

**Regola d'oro**: MAI pushare modifiche a `schema.prisma` senza prima aver creato la migrazione locale con `npx prisma migrate dev`.

### TypeScript

- Backend: compila con `tsc`, test esclusi dalla build produzione
- Frontend: Vite + React + TypeScript

### Docker

- Backend: `node:20-slim` con user non-root, filesystem read-only
- Frontend: `nginx-unprivileged:alpine`
- Database: `postgres:15-alpine`, porta NON esposta all'host
- Network isolata: `fuel-logistics-net`

## Cronologia Recente

- **2026-02-04**: Integrazione CP-SAT solver con frontend
  - Nuova funzione `convertSolverOutputToTrips()` per mapping solver→Trip
  - Nuova funzione `runCPSATOptimizer()` come entry point principale
  - CP-SAT diventa optimizer di default, legacy disponibile con `?optimizer=legacy`
  - Nessuna migrazione DB richiesta
- **2026-02-03**: Ottimizzazione ADR multi-giorno
  - Fix: emptyTanksAtTirano non contava correttamente motrici Livigno
  - Fix: calcolo SUPPLY+SHUTTLE trigger (1 risorsa = 1 SHUTTLE)
  - Fix: pendingFullTrailers persi nella FASE 2
  - Refactor: SUPPLY+SHUTTLE combo valutato PRIMA di SUPPLY standard
  - Refactor: driver Livigno decide dinamicamente SHUTTLE vs SUPPLY in FASE 2
  - Risultato: ADR usate solo quando aumentano i litri, Marco fa quasi sempre SHUTTLE
- **2026-02-03**: Rinominata terminologia cisterne → rimorchi/serbatoio integrato
- **2026-02-03**: Aggiunto CI/CD GitHub Actions, allineato seed con DB locale
- **2026-02-03**: Deploy Docker su flipr-nue con security isolation
- **2026-02-01**: Feature stato iniziale eccezioni ADR

## Algoritmo Ottimizzazione

### Dual-System: CP-SAT (default) + Legacy (fallback)

Il sistema supporta due optimizer:

| Optimizer | Quando usarlo | API |
|-----------|---------------|-----|
| **CP-SAT** (default) | Produzione, risultati ottimali | `?optimizer=cpsat` o nessun parametro |
| **Legacy** | Fallback, debug, confronto | `?optimizer=legacy` |

### CP-SAT Solver (OR-Tools)

**File**: `backend/src/solver/solver.py` + `backend/src/services/optimizer-cpsat.service.ts`

Il solver CP-SAT usa constraint programming per:
- Modellazione time-indexed a slot da 15 min
- Vincoli no-overlap per driver
- Bilanci stock/flotta per ogni slot
- Limiti ADR (giornaliero/settimanale/bisettimanale)
- Pausa 4h30→45' con finestra mobile
- Finestra ingresso Livigno (08:00–18:30)

**Mapping Task → TripType**:

| Task | TripType | Slot | Minuti |
|------|----------|------|--------|
| S | SUPPLY_MILANO | 23 | 345 |
| U | SHUTTLE_LIVIGNO | 16 | 240 |
| V | SHUTTLE_FROM_LIVIGNO | 18 | 270 |
| A | SUPPLY_FROM_LIVIGNO | 39 | 585 |
| R | TRANSFER_TIRANO | 2 | 30 |

**Flusso dati**:
```
runCPSATOptimizer(scheduleId)
  → Build SolverInput from DB
  → Call Python solver via stdin/stdout
  → convertSolverOutputToTrips()
  → Save Trip records to DB
```

### Legacy Optimizer (v2)

**File**: `backend/src/services/optimizer.service.ts`

Algoritmo greedy con fasi giornaliere:

1. **STEP 1 - SUPPLY+SHUTTLE combo**: driver Tirano senza risorse iniziali fanno combo (10h, 1 ADR)
2. **STEP 2 - SUPPLY standard**: driver Tirano rimanenti producono risorse per domani (6h, 0 ADR)
3. **FASE 2 - Consegne**: while loop che assegna SHUTTLE, TRANSFER, SUPPLY_FROM_LIVIGNO

### Tipi di trip

| Trip | Durata | Chi | Consegna | Risorse |
|------|--------|-----|----------|---------|
| SHUTTLE_LIVIGNO | 4h | Tirano | 17.500L | Consuma motrice piena |
| SUPPLY_MILANO | 6h | Tirano | 0L | Produce rimorchio + motrice pieni |
| SUPPLY+SHUTTLE combo | 10h | Tirano (ADR) | 17.500L | Produce rimorchio pieno |
| TRANSFER | 0.5h | Tirano | 0L | Rimorchio → motrice |
| SHUTTLE_FROM_LIVIGNO | 4.5h | Livigno | 17.500L | Consuma rimorchio pieno (TRANSFER implicito) |
| SUPPLY_FROM_LIVIGNO | 10h | Livigno (ADR) | 17.500L | Produce rimorchio pieno |

### Vincolo critico

**I rimorchi NON salgono MAI a Livigno.** Vengono sganciati/travasati a Tirano.
