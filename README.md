# Fuel Logistics Management System

Sistema di gestione e ottimizzazione dei turni di trasporto carburante.

## Funzionalita

- Configurazione asset (motrici, rimorchi, autisti, luoghi)
- Pianificazione automatica turni basata su fabbisogno litri
- Modifica manuale con validazione vincoli ADR in tempo reale
- Calcolo costi (autisti a chiamata)
- Reporting completo

## Stack Tecnologico

- **Frontend**: React 18 + TypeScript + Vite + Shadcn/ui + TanStack Query
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Prisma ORM
- **Calendar**: react-big-calendar

## Prerequisiti

- Node.js 18+
- PostgreSQL 15+ (via Homebrew: `brew install postgresql@15`)
- pnpm, npm o yarn

## Quick Start

```bash
./start.sh
```

Lo script avvia backend e frontend. Per terminare: `./start.sh --kill-only`

## Setup Manuale

### 1. Avviare PostgreSQL

```bash
brew services start postgresql@15
createdb fuel_logistics
```

### 2. Setup Backend

```bash
cd backend
npm install

# Crea il file .env (gia presente con valori di default)
cp .env.example .env  # se necessario

# Genera il client Prisma
npm run db:generate

# Esegui le migrazioni
npm run db:push

# Popola con dati iniziali
npm run db:seed

# Avvia il server di sviluppo
npm run dev
```

Il backend sara disponibile su http://localhost:3001

### 3. Setup Frontend

```bash
cd frontend
npm install

# Avvia il server di sviluppo
npm run dev
```

Il frontend sara disponibile su http://localhost:5174

## Struttura Progetto

```
fuel-logistics/
├── frontend/              # React + Vite
│   ├── src/
│   │   ├── components/    # Componenti UI
│   │   ├── pages/         # Pagine dell'applicazione
│   │   ├── hooks/         # Custom hooks (TanStack Query)
│   │   ├── api/           # Client API
│   │   ├── types/         # TypeScript types
│   │   └── lib/           # Utilities
│   └── ...
│
├── backend/               # Express + TypeScript
│   ├── src/
│   │   ├── controllers/   # Route handlers
│   │   ├── services/      # Business logic
│   │   ├── routes/        # API routes
│   │   ├── middleware/    # Express middleware
│   │   └── utils/         # Utilities
│   ├── prisma/
│   │   ├── schema.prisma  # Database schema
│   │   └── seed.ts        # Seed data
│   └── ...
│
└── start.sh               # Script avvio (backend + frontend)
```

## API Endpoints

### Risorse CRUD
- `GET/POST /api/vehicles` - Motrici
- `GET/POST /api/trailers` - Rimorchi
- `GET/POST /api/drivers` - Autisti
- `GET/POST /api/locations` - Luoghi
- `GET/POST /api/routes` - Percorsi

### Pianificazione
- `GET/POST /api/schedules` - Pianificazioni
- `POST /api/schedules/calculate-max` - Calcola capacità massima teorica
- `POST /api/schedules/:id/optimize` - Genera turni automatici
- `POST /api/schedules/:id/validate` - Valida vincoli ADR
- `PUT /api/schedules/:id/confirm` - Conferma pianificazione
- `GET/POST/PUT/DELETE /api/schedules/:id/trips` - Gestione viaggi

### Report
- `GET /api/reports/trips` - Report viaggi
- `GET /api/reports/drivers` - Report autisti
- `GET /api/reports/costs` - Report costi
- `GET /api/reports/liters` - Report litri
- `GET /api/reports/efficiency` - Report efficienza

## Vincoli ADR Implementati

- Max 9h guida giornaliere (estendibile a 10h max 2x/settimana)
- Max 56h guida settimanali
- Max 90h guida bi-settimanali
- Pausa obbligatoria dopo 4h30 di guida
- Riposo giornaliero minimo 11h (riducibile a 9h max 3x)
- Controllo scadenza patentini ADR

## Logica di Ottimizzazione

L'algoritmo di ottimizzazione:
1. Traccia lo stato delle rimorchi in tutte le location (Tirano, Livigno, Milano)
2. Assegna i viaggi ottimali in base alle risorse disponibili:
   - Driver Tirano: SUPPLY, SHUTTLE, o FULL_ROUND
   - Driver Livigno: SHUTTLE se ci sono piene, altrimenti SUPPLY
3. Distribuisce i viaggi rispettando i vincoli ADR (9h/giorno, 56h/settimana)
4. Massimizza i litri consegnati utilizzando rimorchi da qualsiasi location

### Tipi di Viaggio

| Tipo | Durata | Litri Consegnati | Descrizione |
|------|--------|------------------|-------------|
| `SHUTTLE_LIVIGNO` | 4h | 17.500L | Tirano → Livigno → Tirano (motrice piena) |
| `TRANSFER_TIRANO` | 0.5h | 0L | Sversamento rimorchio → serbatoio motrice |
| `SUPPLY_MILANO` | 6h | 0L | Tirano → Milano → Tirano (riempie motrice + rimorchio) |
| `FULL_ROUND` | 9.5h | 17.500L | Tirano → Milano → Tirano → Livigno → Tirano |
| `SHUTTLE_FROM_LIVIGNO` | 4.5h | 17.500L | Livigno → Tirano (transfer) → Livigno |
| `SUPPLY_FROM_LIVIGNO` | 10h | 17.500L | Livigno → Tirano → Milano → Tirano → Livigno |

### Driver in Eccesso

L'algoritmo calcola all'inizio di ogni giornata quanti driver Tirano sono "in eccesso" rispetto ai rimorchi pieni disponibili. I driver in eccesso vengono assegnati a `SUPPLY_MILANO` invece di `TRANSFER` inutili, preparando risorse per il giorno successivo.

---

## Eccezioni ADR

L'algoritmo utilizza automaticamente le eccezioni ADR (max 2/settimana per driver) per massimizzare le consegne:

### Driver Livigno
- `SUPPLY_FROM_LIVIGNO` (10h con eccezione ADR)
- Consegna 17.500L + lascia rimorchio pieno a Tirano

### Driver Tirano
- **Combo SUPPLY+SHUTTLE** (6h + 4h = 10h con eccezione ADR)
- SUPPLY riempie motrice + rimorchio, SHUTTLE consegna 17.500L

### Tracking Eccezioni
- Ogni driver puo usare max 2 eccezioni/settimana
- Reset automatico ogni 5 giorni lavorativi
- Visualizzazione nel frontend con badge amber

### Stato Iniziale Eccezioni

Prima di lanciare l'ottimizzazione, l'operatore puo specificare quante eccezioni ADR ogni driver ha gia usato nella settimana corrente:

1. Cliccare "Genera Turni" nella pagina Schedule
2. Nel dialog, impostare il numero di eccezioni gia usate (0, 1 o 2) per ogni driver
3. L'algoritmo rispettera i limiti rimanenti

---

## ⚠️ Limitazioni Algoritmo Attuale

### 1. FULL_ROUND Non Eseguibile (9.5h > 9h ADR)

```
FULL_ROUND richiede 9.5h ma il limite ADR giornaliero e 9h.
```

**Impatto**: Driver Tirano non possono eseguire `FULL_ROUND` senza eccezione ADR.

### 2. ~~No Combo SUPPLY + SHUTTLE~~ → RISOLTO

I driver Tirano ora possono fare SUPPLY+SHUTTLE (10h) usando l'eccezione ADR.

### 3. ~~Eccezione ADR Solo per Driver Livigno~~ → RISOLTO

L'eccezione ADR e ora disponibile per tutti i driver:
- Driver Livigno: `SUPPLY_FROM_LIVIGNO`
- Driver Tirano: combo `SUPPLY + SHUTTLE`

---

### Esempio Pratico: Scenario 0 Rimorchi Pieni

Con **0 rimorchi pieni**, **4 vuoti**, **1 giorno**, **3 driver**:

| Driver | Azione | Eccezione ADR | Litri |
|--------|--------|---------------|-------|
| Marco (Livigno) | `SUPPLY_FROM_LIVIGNO` | Si (1/2) | **17.500L** |
| Luca (Tirano) | `SUPPLY+SHUTTLE` combo | Si (1/2) | **17.500L** |
| Paolo (Tirano) | `SUPPLY+SHUTTLE` combo | Si (1/2) | **17.500L** |

**MAX = 52.500L** (3 eccezioni ADR usate)

---

### Test di Verifica

I test coprono questi scenari:

```bash
cd backend
npx tsx src/tests/optimizer-allocation.test.ts  # 7 scenari calculateMaxCapacity
npx tsx src/tests/optimizer-trips.test.ts       # Generazione trip
```

## Dati di Test

Il seed popola il database con:
- 3 luoghi: Milano (sorgente), Tirano (parcheggio), Livigno (destinazione)
- 4 percorsi predefiniti con tempi e costi
- 2 motrici
- 3 rimorchi da 17.500L
- 3 autisti (2 dipendenti + 1 a chiamata)

## Comandi Utili

```bash
# Backend
npm run dev          # Avvia in modalita sviluppo
npm run db:studio    # Apri Prisma Studio (GUI database)
npm run db:seed      # Ripopola dati iniziali

# Frontend
npm run dev          # Avvia in modalita sviluppo
npm run build        # Build produzione
```

## Note

- Per il calcolo delle rotte, configurare `ORS_API_KEY` nel `.env` con una chiave di OpenRouteService
- Senza API key, il sistema usa stime basate sulla distanza in linea d'aria
