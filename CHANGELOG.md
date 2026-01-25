# Changelog

Tutte le modifiche rilevanti al progetto Fuel Logistics Management System saranno documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [1.1.0] - 2026-01-25

### Aggiunto

#### Backend

- **Endpoint stato risorse** (`src/controllers/`)
  - `GET /api/trailers/status` - Posizione corrente cisterne (Milano/Tirano/In Viaggio)
  - `GET /api/vehicles/status` - Stato motrici con viaggi assegnati
  - `GET /api/drivers/availability` - Disponibilità autisti con ore lavorate/rimanenti ADR

#### Frontend

- **Dark Mode** (`src/components/layout/ThemeToggle.tsx`)
  - Toggle sole/luna in alto a destra
  - Salvataggio preferenza in localStorage
  - Rispetto preferenza di sistema come default
  - Aggiornato CSS calendario per dark mode

- **Box Stato Risorse** (`src/pages/ScheduleDetail.tsx`)
  - Card "Stato Cisterne" con posizione: Deposito Milano (blu), Parcheggio Tirano (arancione), In Viaggio (viola)
  - Card "Stato Motrici" con badge disponibile/in uso e conteggio viaggi
  - Card "Disponibilità Autisti" con barra ore settimanali (verde/giallo/rosso)

- **Modal Viaggio Migliorato** (`src/pages/ScheduleDetail.tsx`)
  - Supporto multiple cisterne (fino a `maxTrailers` della motrice)
  - Per ogni cisterna: selezione con posizione corrente, litri caricati
  - Checkbox "Recupero da Tirano" (pickup cisterna già parcheggiata)
  - Checkbox "Sgancia a Tirano" (drop-off cisterna al parcheggio)
  - Reset automatico drop-off quando si attiva pickup

- **Calendario Migliorato**
  - Eventi mostrano: Autista - Targa + Cisterne (Litri)
  - Icona freccia giù per sgancio cisterna
  - Icona freccia su per recupero cisterna
  - Componente evento custom con più informazioni

- **Hooks e API** (`src/hooks/`, `src/api/client.ts`)
  - `useTrailersStatus()` - Stato cisterne
  - `useVehiclesStatus()` - Stato motrici
  - `useDriversAvailability()` - Disponibilità autisti
  - Invalidazione cache risorse dopo CRUD viaggi e ottimizzazione

- **Tipi TypeScript** (`src/types/index.ts`)
  - `TrailerStatus` - Stato cisterna con posizione
  - `VehicleStatus` - Stato motrice con viaggi
  - `DriverAvailability` - Disponibilità autista con statistiche ADR

### Corretto

- **Logica stato risorse** - Lo stato attuale (IN_TRANSIT, IN_USE, DRIVING) ora considera tutti i viaggi, non solo quelli della pianificazione corrente
- **Cache invalidation** - Le query stato risorse vengono invalidate dopo creazione/modifica/eliminazione viaggi
- **Checkbox cisterne** - Attivando "Recupero da Tirano" ora resetta automaticamente "Sgancia a Tirano"
- **Dark mode badge** - Aggiunte classi dark per tutti i badge colorati

---

## [1.0.0] - 2026-01-25

### Aggiunto

#### Backend (Node.js + Express + TypeScript + Prisma)

- **Database Schema** (`prisma/schema.prisma`)
  - Modello `Location` per gestione luoghi (sorgenti, destinazioni, parcheggi)
  - Modello `Vehicle` per motrici con capacita massima cisterne
  - Modello `Trailer` per cisterne con capacita in litri
  - Modello `Driver` per autisti con tipo (dipendente/chiamata/emergenza), scadenze ADR
  - Modello `Route` per percorsi predefiniti con distanza, durata, pedaggi
  - Modello `Schedule` per pianificazioni con periodo e litri richiesti
  - Modello `Trip` per singoli viaggi con assegnazione risorse
  - Modello `TripTrailer` per associazione viaggio-cisterna con gestione sgancio
  - Modello `DriverWorkLog` per registro ore lavorate (vincoli ADR)
  - Modello `Setting` per configurazioni globali

- **API REST** (`src/routes/index.ts`)
  - CRUD completo per tutte le entita (vehicles, trailers, drivers, locations, routes)
  - Endpoint pianificazione: `/api/schedules/:id/optimize`, `/api/schedules/:id/validate`, `/api/schedules/:id/confirm`
  - Gestione viaggi: `/api/schedules/:id/trips` (GET, POST, PUT, DELETE)
  - Report: `/api/reports/trips`, `/api/reports/drivers`, `/api/reports/costs`, `/api/reports/liters`, `/api/reports/efficiency`

- **Servizio Validazione ADR** (`src/services/adrValidator.service.ts`)
  - Limiti guida giornaliera (9h, estendibile a 10h max 2x/settimana)
  - Limiti guida settimanale (56h) e bi-settimanale (90h)
  - Controllo pause obbligatorie dopo 4h30
  - Verifica riposo giornaliero minimo (11h, riducibile a 9h)
  - Controllo scadenza patentini ADR e specializzazione cisterne
  - Generazione violazioni (ERROR) e avvisi (WARNING)

- **Servizio Ottimizzazione** (`src/services/optimizer.service.ts`)
  - Calcolo automatico numero viaggi necessari basato su litri richiesti
  - Distribuzione viaggi su giorni lavorativi disponibili
  - Assegnazione autisti con rispetto vincoli ADR
  - Gestione cisterne parcheggiate (sgancio a Tirano, recupero successivo)
  - Prioritizzazione autisti dipendenti vs a chiamata

- **Servizio Routing** (`src/services/routing.service.ts`)
  - Integrazione OpenRouteService per calcolo percorsi reali
  - Fallback con calcolo stimato (Haversine + fattore strada)
  - Cache risultati per ottimizzazione performance
  - Percorsi predefiniti Milano-Tirano-Livigno

- **Middleware**
  - Gestione errori centralizzata con supporto Zod e Prisma errors
  - Validazione request body con Zod schemas
  - Autenticazione JWT (predisposta)

- **Seed Data** (`prisma/seed.ts`)
  - 3 luoghi: Milano Deposito, Tirano Parcheggio, Livigno Distributore
  - 4 percorsi con tempi e costi realistici
  - 2 motrici, 3 cisterne da 17.500L
  - 3 autisti (2 dipendenti + 1 a chiamata)

#### Frontend (React 18 + TypeScript + Vite + Shadcn/ui)

- **Componenti UI** (`src/components/ui/`)
  - Button, Input, Label, Card, Badge, Table, Dialog, Select, Tabs, Toast
  - Styling con Tailwind CSS e class-variance-authority

- **Layout** (`src/components/layout/`)
  - Sidebar con navigazione tra sezioni
  - Layout principale con Outlet per routing
  - Sistema notifiche Toast

- **Pagine**
  - **Dashboard** (`src/pages/Dashboard.tsx`): statistiche rapide, alert patentini, pianificazioni attive
  - **Vehicles** (`src/pages/Vehicles.tsx`): CRUD motrici con tabella e dialog
  - **Trailers** (`src/pages/Trailers.tsx`): CRUD cisterne con capacita
  - **Drivers** (`src/pages/Drivers.tsx`): CRUD autisti con gestione scadenze ADR
  - **Locations** (`src/pages/Locations.tsx`): CRUD luoghi con tipo e coordinate
  - **Routes** (`src/pages/Routes.tsx`): CRUD percorsi con calcolo automatico distanza
  - **Schedules** (`src/pages/Schedules.tsx`): lista pianificazioni con creazione
  - **ScheduleDetail** (`src/pages/ScheduleDetail.tsx`): calendario interattivo, generazione turni, validazione ADR
  - **Reports** (`src/pages/Reports.tsx`): grafici litri/viaggi/costi con Recharts, export CSV

- **Data Fetching** (`src/hooks/`)
  - Custom hooks per ogni entita con TanStack Query v5
  - Mutations per create/update/delete con invalidazione cache
  - Ottimizzazione con staleTime e retry

- **API Client** (`src/api/client.ts`)
  - Wrapper fetch con gestione errori
  - Tipizzazione completa richieste/risposte

- **Utilita** (`src/lib/utils.ts`)
  - Formattazione date, numeri, valuta (locale italiano)
  - Helper per status, colori, label
  - Controllo scadenze licenze

#### Infrastruttura

- **Docker Compose** per PostgreSQL 15
- **Configurazione TypeScript** per backend e frontend
- **Tailwind CSS** con tema personalizzato Shadcn
- **Vite** con proxy API per sviluppo

### Architettura

```
fuel-logistics/
├── backend/
│   ├── src/
│   │   ├── controllers/    # 7 controller REST
│   │   ├── services/       # Business logic (ADR, optimizer, routing)
│   │   ├── routes/         # Express router
│   │   ├── middleware/     # Auth, errors, validation
│   │   └── utils/          # Zod validators
│   └── prisma/             # Schema + migrations + seed
│
├── frontend/
│   └── src/
│       ├── components/     # UI (Shadcn) + layout
│       ├── pages/          # 9 pagine React
│       ├── hooks/          # TanStack Query hooks
│       ├── api/            # API client
│       ├── types/          # TypeScript interfaces
│       └── lib/            # Utilities
│
└── docker-compose.yml
```

### Note Tecniche

- Il calendario usa `react-big-calendar` con localizzazione italiana
- I grafici sono implementati con `recharts`
- La validazione form usa `react-hook-form` + `zod`
- L'ottimizzatore considera la capacita cisterna standard di 17.500L
- Il tempo medio viaggio Milano-Livigno e stimato in 8 ore A/R
