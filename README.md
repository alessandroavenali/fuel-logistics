# Fuel Logistics Management System

Sistema di gestione e ottimizzazione dei turni di trasporto carburante.

## Funzionalita

- Configurazione asset (motrici, cisterne, autisti, luoghi)
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
- Docker (per PostgreSQL)
- pnpm, npm o yarn

## Setup

### 1. Avviare il Database

```bash
cd fuel-logistics
docker-compose up -d
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
└── docker-compose.yml     # PostgreSQL
```

## API Endpoints

### Risorse CRUD
- `GET/POST /api/vehicles` - Motrici
- `GET/POST /api/trailers` - Cisterne
- `GET/POST /api/drivers` - Autisti
- `GET/POST /api/locations` - Luoghi
- `GET/POST /api/routes` - Percorsi

### Pianificazione
- `GET/POST /api/schedules` - Pianificazioni
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
1. Calcola il numero di viaggi necessari in base ai litri richiesti
2. Distribuisce i viaggi sui giorni lavorativi disponibili
3. Assegna autisti rispettando i vincoli ADR
4. Gestisce le cisterne parcheggiate a Tirano (sgancio/recupero)

## Dati di Test

Il seed popola il database con:
- 3 luoghi: Milano (sorgente), Tirano (parcheggio), Livigno (destinazione)
- 4 percorsi predefiniti con tempi e costi
- 2 motrici
- 3 cisterne da 17.500L
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
