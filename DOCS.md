# Fuel Logistics - Documentazione Funzionale

## Indice
1. [Panoramica](#panoramica)
2. [Glossario](#glossario)
3. [Architettura](#architettura)
4. [Moduli Funzionali](#moduli-funzionali)
5. [Flussi Utente](#flussi-utente)
6. [Regole di Business](#regole-di-business)
7. [API Reference](#api-reference)
8. [Database Schema](#database-schema)

---

## Panoramica

**Fuel Logistics** è un sistema per gestire il trasporto di carburante da un deposito (Milano) alla base operativa montana (Livigno), con un parcheggio intermedio (Tirano) dove le cisterne possono essere sganciate.

### Flusso Operativo
La **base operativa** è Livigno. Le motrici e cisterne vuote partono da Livigno, vanno a Milano a caricare il carburante, e tornano a Livigno.

**Vincolo tratta montana:**
- Livigno ↔ Tirano: **max 1 cisterna** (strada di montagna)
- Tirano ↔ Milano: **max 2 cisterne**

**Viaggio tipo:**
1. Partenza da Livigno con 1 cisterna vuota
2. Arrivo a Tirano → eventuale aggancio 2° cisterna vuota
3. Partenza da Tirano con 1-2 cisterne
4. Arrivo a Milano → carico carburante
5. Partenza da Milano con cisterne piene
6. Arrivo a Tirano → eventuale sgancio 1 cisterna piena
7. Partenza da Tirano con 1 cisterna (vincolo montagna)
8. Arrivo a Livigno → scarico carburante

### Problema risolto
- Pianificare i viaggi per soddisfare un fabbisogno di litri in un periodo
- Rispettare i vincoli ADR (ore di guida, riposi obbligatori)
- Gestire lo sgancio/recupero cisterne a Tirano (ottimizzazione capacità)
- Calcolare i costi degli autisti a chiamata

### Utenti target
- Responsabili logistica che pianificano i turni
- Dispatcher che monitorano i viaggi

---

## Glossario

| Termine | Descrizione |
|---------|-------------|
| **Motrice** | Veicolo trainante (camion) che può trainare 1-2 cisterne |
| **Cisterna/Trailer** | Rimorchio contenente il carburante (capacità standard: 17.500 litri) |
| **Autista Dipendente (RESIDENT)** | Autista assunto a tempo indeterminato |
| **Autista a Chiamata (ON_CALL)** | Autista pagato a ore quando necessario |
| **Autista Emergenza (EMERGENCY)** | Autista per situazioni eccezionali |
| **Sorgente (SOURCE)** | Luogo di carico carburante (es. Milano Deposito) |
| **Destinazione (DESTINATION)** | Luogo di scarico finale (es. Livigno) |
| **Parcheggio (PARKING)** | Luogo intermedio per sgancio cisterne (es. Tirano) |
| **Schedule/Pianificazione** | Piano di viaggi per un periodo con un obiettivo di litri |
| **Trip/Viaggio** | Singolo viaggio con autista, motrice e cisterne assegnate |
| **ADR** | Accordo europeo trasporto merci pericolose - regola ore guida |

---

## Architettura

### Stack Tecnologico
```
Frontend (porta 5174)          Backend (porta 3001)         Database (porta 5432)
┌─────────────────────┐       ┌─────────────────────┐      ┌──────────────┐
│ React 18 + Vite     │       │ Express + TypeScript│      │ PostgreSQL   │
│ Shadcn/ui           │ ───── │ Prisma ORM          │ ──── │              │
│ TanStack Query      │ /api  │ Zod validation      │      │              │
│ react-big-calendar  │       │                     │      │              │
│ Recharts            │       │                     │      │              │
└─────────────────────┘       └─────────────────────┘      └──────────────┘
```

### Struttura Cartelle
```
fuel-logistics/
├── backend/
│   ├── src/
│   │   ├── controllers/     # Gestione richieste HTTP
│   │   ├── services/        # Logica di business
│   │   │   ├── adrValidator.service.ts   # Validazione vincoli ADR
│   │   │   ├── optimizer.service.ts      # Generazione automatica turni
│   │   │   ├── routing.service.ts        # Calcolo percorsi
│   │   │   └── reports.service.ts        # Aggregazioni report
│   │   ├── routes/          # Definizione endpoint
│   │   ├── middleware/      # Auth, errori, validazione
│   │   └── utils/           # Schemi Zod
│   └── prisma/
│       ├── schema.prisma    # Modello dati
│       └── seed.ts          # Dati iniziali
│
└── frontend/
    └── src/
        ├── pages/           # 9 pagine dell'app
        ├── components/      # UI components
        ├── hooks/           # Data fetching (TanStack Query)
        ├── api/             # Client HTTP
        └── types/           # TypeScript interfaces
```

---

## Moduli Funzionali

### 1. Dashboard (`/`)
**Scopo**: Vista d'insieme dello stato del sistema

**Mostra**:
- Contatori: motrici attive, cisterne attive, autisti attivi, litri totali trasportati
- Alert patentini in scadenza (prossimi 30 giorni)
- Lista pianificazioni attive (DRAFT o CONFIRMED)
- Statistiche rapide: media litri/giorno, autisti per tipo

---

### 2. Gestione Motrici (`/vehicles`)
**Scopo**: CRUD veicoli trainanti

**Campi**:
- `plate`: Targa (univoca)
- `name`: Nome identificativo (opzionale)
- `maxTrailers`: Numero massimo cisterne trainabili (default: 2)
- `isActive`: Stato attivo/inattivo

**Funzionalità**:
- Lista con filtro per stato
- Creazione/modifica via dialog
- Toggle attivo/inattivo con click su badge
- Eliminazione con conferma

---

### 3. Gestione Cisterne (`/trailers`)
**Scopo**: CRUD rimorchi cisterna

**Campi**:
- `plate`: Targa (univoca)
- `name`: Nome identificativo (opzionale)
- `capacityLiters`: Capacità in litri (default: 17.500)
- `isActive`: Stato attivo/inattivo

**Funzionalità**: Come motrici

---

### 4. Gestione Autisti (`/drivers`)
**Scopo**: CRUD autisti con gestione certificazioni ADR

**Campi**:
- `name`: Nome completo
- `type`: RESIDENT | ON_CALL | EMERGENCY
- `phone`: Telefono (opzionale)
- `adrLicenseExpiry`: Scadenza patentino ADR
- `adrCisternExpiry`: Scadenza specializzazione cisterne
- `weeklyWorkingDays`: Giorni lavorativi/settimana (default: 5)
- `hourlyCost`: Costo orario (solo per ON_CALL)
- `isActive`: Stato

**Funzionalità**:
- Indicatore visivo patentini in scadenza (< 30 giorni) o scaduti
- Badge colorati per stato licenze (verde/giallo/rosso)
- Filtro per tipo autista

---

### 5. Gestione Luoghi (`/locations`)
**Scopo**: CRUD punti geografici

**Campi**:
- `name`: Nome luogo
- `type`: SOURCE | DESTINATION | PARKING
- `address`: Indirizzo completo
- `latitude`, `longitude`: Coordinate GPS (opzionali, per calcolo percorsi)
- `isActive`: Stato

**Tipi**:
- **SOURCE** (blu): Punto di carico (fornitore)
- **DESTINATION** (verde): Punto di scarico finale
- **PARKING** (arancione): Parcheggio intermedio per sgancio cisterne

---

### 6. Gestione Percorsi (`/routes`)
**Scopo**: Definire tratte con distanza, tempo e costi

**Campi**:
- `name`: Nome percorso (es. "Milano -> Tirano")
- `fromLocationId`: Luogo partenza
- `toLocationId`: Luogo arrivo
- `distanceKm`: Distanza in km
- `durationMinutes`: Durata in minuti
- `tollCost`: Costo pedaggi (opzionale)
- `isActive`: Stato

**Funzionalità**:
- Pulsante "Calcola Distanza e Tempo" che usa OpenRouteService (se configurato) o stima basata su coordinate
- Selezione luoghi da dropdown

---

### 7. Pianificazione (`/schedules`)
**Scopo**: Creare e gestire piani di trasporto

**Campi Schedule**:
- `name`: Nome pianificazione (es. "Settimana 1-7 Febbraio")
- `startDate`, `endDate`: Periodo
- `requiredLiters`: Litri totali richiesti
- `status`: DRAFT | CONFIRMED | COMPLETED | CANCELLED
- `notes`: Note (opzionale)

**Lista pianificazioni**:
- Nome, periodo, litri richiesti, numero viaggi, stato
- Click su icona occhio → dettaglio
- Eliminazione solo per DRAFT

---

### 8. Dettaglio Pianificazione (`/schedules/:id`)
**Scopo**: Gestione completa dei viaggi di una pianificazione

**Sezioni**:

#### Header
- Nome, periodo, badge stato
- Pulsanti azioni (solo per DRAFT):
  - **Genera Turni**: Avvia ottimizzatore automatico
  - **Valida ADR**: Verifica vincoli ore guida
  - **Conferma**: Passa a stato CONFIRMED

#### Statistiche
- Litri richiesti vs litri pianificati
- Numero viaggi
- Percentuale copertura

#### Stato Risorse (3 card)
- **Stato Cisterne**: Posizione corrente di ogni cisterna
  - Blu: Deposito Milano
  - Arancione: Parcheggio Tirano
  - Viola: In Viaggio
- **Stato Motrici**: Disponibile/In uso + numero viaggi assegnati
- **Disponibilità Autisti**: Barra ore settimanali con indicatore (verde <50%, giallo 50-80%, rosso >80%)

#### Risultato Validazione ADR
- Box verde se tutto OK
- Box rosso con lista violazioni (errori bloccanti)
- Lista avvisi (warning non bloccanti)

#### Calendario Interattivo
- Vista settimana/mese
- Eventi mostrano: Autista - Targa + Cisterne (Litri)
- Icone speciali:
  - ⬇️ Sgancio cisterna a Tirano
  - ⬆️ Recupero cisterna da Tirano
- Colori per stato viaggio:
  - Blu: PLANNED
  - Viola: IN_PROGRESS
  - Verde: COMPLETED
  - Rosso: CANCELLED
- Click su evento → dialog dettaglio/modifica
- Click su slot vuoto → crea nuovo viaggio (solo DRAFT)
- Orari: 05:00 - 22:00

#### Dialog Viaggio (Migliorato)
- Selezione autista (con tipo e stato)
- Selezione motrice (con max cisterne)
- Data e ora partenza
- **Sezione Cisterne** (multiple, fino a maxTrailers):
  - Selezione cisterna con posizione corrente
  - Litri caricati
  - Checkbox "Recupero da Tirano" (pickup)
  - Checkbox "Sgancia a Tirano" (drop-off)
- Pulsanti: Elimina, Annulla, Salva

---

### 9. Report (`/reports`)
**Scopo**: Analisi dati con grafici e tabelle esportabili

**Filtri globali**: Data inizio, data fine

**Tab disponibili**:

#### Litri
- KPI: totale litri, media giornaliera, giorni con viaggi
- Grafico linea andamento giornaliero
- Export CSV

#### Viaggi
- KPI: totale, completati, cancellati, litri
- Tabella dettaglio viaggi

#### Autisti
- Tabella: nome, tipo, viaggi, ore guida, ore lavoro, costo stimato
- Grafico barre ore per autista
- Export CSV

#### Costi
- KPI: costo totale autisti, numero viaggi
- Tabella dettaglio costi autisti a chiamata

#### Efficienza
- Tabella pianificazioni con:
  - Litri richiesti vs consegnati
  - Percentuale efficienza (badge verde >100%, giallo >80%, rosso <80%)
  - Viaggi completati/totali

---

## Flussi Utente

### Flusso 1: Creare una nuova pianificazione

1. Vai a **Pianificazione** (`/schedules`)
2. Click **Nuova Pianificazione**
3. Compila:
   - Nome (es. "Febbraio Settimana 1")
   - Data inizio e fine
   - Litri richiesti (es. 70.000)
4. Click **Crea**
5. Vai al dettaglio (click icona occhio)
6. Click **Genera Turni** → l'ottimizzatore crea i viaggi
7. Verifica sul calendario
8. Click **Valida ADR** → controlla violazioni
9. Se OK, click **Conferma**

### Flusso 2: Modificare manualmente un viaggio

1. Nel dettaglio pianificazione (stato DRAFT)
2. Click su un evento nel calendario
3. Modifica autista, motrice, orario
4. Click **Salva**
5. Ri-valida ADR per verificare

### Flusso 3: Aggiungere un viaggio manuale

1. Nel dettaglio pianificazione (stato DRAFT)
2. Click su uno slot vuoto nel calendario OPPURE click **Aggiungi Viaggio**
3. Seleziona autista, motrice, cisterna
4. Imposta data, ora, litri
5. Click **Crea**

### Flusso 4: Controllare patentini in scadenza

1. Vai a **Dashboard** → sezione "Patentini in Scadenza"
2. Oppure vai a **Autisti** → colonne ADR e Cisterne mostrano badge colorati

### Flusso 5: Analizzare i costi

1. Vai a **Report** → tab **Costi**
2. Imposta periodo
3. Vedi totale costi autisti a chiamata
4. Dettaglio per autista: ore lavorate × costo orario

---

## Regole di Business

### Vincoli ADR (Accordo Europeo Trasporto Merci Pericolose)

| Vincolo | Limite | Note |
|---------|--------|------|
| Guida giornaliera | Max 9 ore | Estendibile a 10h max 2 volte/settimana |
| Guida settimanale | Max 56 ore | |
| Guida bi-settimanale | Max 90 ore | |
| Pausa obbligatoria | Dopo 4h30 | Pausa minima 45 minuti |
| Riposo giornaliero | Min 11 ore | Riducibile a 9h max 3 volte tra riposi settimanali |
| Riposo settimanale | Min 45 ore | Riducibile a 24h con recupero |

### Logica Ottimizzatore

1. **Calcola viaggi necessari**: `ceil(litriRichiesti / 17500)`
2. **Identifica giorni lavorativi** nel periodo (lun-ven)
3. **Per ogni viaggio**:
   - Trova autista disponibile (priorità: RESIDENT > ON_CALL)
   - Verifica vincoli ADR
   - Trova motrice libera
   - Trova cisterne (prima quelle parcheggiate a Tirano, poi dalla sorgente)
4. **Assegna risorse** e aggiorna tracker disponibilità

### Gestione Cisterne a Tirano

Il parcheggio di Tirano serve come punto di scambio per ottimizzare i viaggi:

**Andata (cisterne vuote):**
- La motrice parte da Livigno con 1 cisterna vuota (vincolo montagna)
- A Tirano può agganciare una 2° cisterna vuota (`isPickup = true`)
- Prosegue verso Milano con 1-2 cisterne

**Ritorno (cisterne piene):**
- La motrice parte da Milano con le cisterne piene
- A Tirano può sganciare 1 cisterna piena (`dropOffLocationId`)
- Prosegue verso Livigno con 1 sola cisterna (vincolo montagna)

**Cisterne parcheggiate a Tirano:**
- Cisterne piene: in attesa di essere portate a Livigno
- Cisterne vuote: in attesa di essere portate a Milano per il carico

### Stima Durata Viaggio

- Durata standard: **8 ore** (andata Milano-Livigno + scarico + ritorno)
- Orario partenza default: **06:00**

---

## API Reference

### Risorse CRUD

Tutte le risorse supportano:
- `GET /api/{resource}` - Lista (query: `isActive`, `type`)
- `GET /api/{resource}/:id` - Dettaglio
- `POST /api/{resource}` - Crea
- `PUT /api/{resource}/:id` - Aggiorna
- `DELETE /api/{resource}/:id` - Elimina

Risorse: `vehicles`, `trailers`, `drivers`, `locations`, `routes`

### Endpoint Speciali

```
POST /api/routes/calculate
Body: { fromCoordinates: {lat, lng}, toCoordinates: {lat, lng} }
Response: { distanceKm, durationMinutes }

GET /api/drivers/expiring?days=30
Response: [drivers con patentini in scadenza]

GET /api/drivers/availability?scheduleId=&from=&to=
Response: [{ id, name, type, status, weeklyStats: { hoursWorked, hoursRemaining, percentUsed }, trips }]

GET /api/vehicles/status?scheduleId=&from=&to=
Response: [{ id, plate, status, currentTrip, tripsCount, trips }]

GET /api/trailers/status?scheduleId=
Response: [{ id, plate, currentLocation, currentLocationName, lastTripId }]

GET /api/drivers/:id/worklog?from=&to=
Response: [log ore lavorate]
```

### Pianificazione

```
GET    /api/schedules
GET    /api/schedules/:id
POST   /api/schedules
PUT    /api/schedules/:id
DELETE /api/schedules/:id

POST   /api/schedules/:id/optimize    → Genera turni automatici
POST   /api/schedules/:id/validate    → Valida vincoli ADR
PUT    /api/schedules/:id/confirm     → Conferma pianificazione

GET    /api/schedules/:id/trips       → Lista viaggi
POST   /api/schedules/:id/trips       → Crea viaggio
PUT    /api/schedules/:id/trips/:tripId
DELETE /api/schedules/:id/trips/:tripId
```

### Report

```
GET /api/reports/trips?from=&to=
GET /api/reports/drivers?from=&to=
GET /api/reports/costs?from=&to=
GET /api/reports/liters?from=&to=
GET /api/reports/efficiency?from=&to=
```

---

## Database Schema

### Entità Principali

```
Location (Luoghi)
├── id, name, type, address, latitude, longitude, isActive

Vehicle (Motrici)
├── id, plate, name, maxTrailers, isActive

Trailer (Cisterne)
├── id, plate, name, capacityLiters, isActive

Driver (Autisti)
├── id, name, type, phone, adrLicenseExpiry, adrCisternExpiry
├── weeklyWorkingDays, hourlyCost, isActive

Route (Percorsi)
├── id, name, fromLocationId, toLocationId
├── distanceKm, durationMinutes, tollCost, isActive

Schedule (Pianificazioni)
├── id, name, startDate, endDate, requiredLiters, status, notes

Trip (Viaggi)
├── id, scheduleId, vehicleId, driverId
├── date, departureTime, returnTime, status, notes

TripTrailer (Associazione Viaggio-Cisterna)
├── id, tripId, trailerId, litersLoaded
├── dropOffLocationId, isPickup

DriverWorkLog (Registro Ore)
├── id, driverId, date, drivingHours, workingHours, restHours, weekNumber
```

### Relazioni

```
Location 1──N Route (from/to)
Location 1──N TripTrailer (dropOff)

Vehicle 1──N Trip
Driver 1──N Trip
Driver 1──N DriverWorkLog

Schedule 1──N Trip
Trip 1──N TripTrailer
Trailer 1──N TripTrailer
```

---

## Dati di Test (Seed)

Il seed (`npm run db:seed`) crea:

**Luoghi**:
- Milano Deposito (SOURCE) - 45.4642, 9.19
- Tirano Parcheggio (PARKING) - 46.2167, 10.1667
- Livigno Distributore (DESTINATION) - 46.5389, 10.1353

**Percorsi**:
- Milano → Tirano: 150km, 2h30, €15 pedaggio
- Tirano → Livigno: 45km, 45min, €0
- Livigno → Tirano: 45km, 45min, €0
- Tirano → Milano: 150km, 2h30, €15 pedaggio

**Veicoli**:
- AA123BB "Motrice 1" (max 2 cisterne)
- CC456DD "Motrice 2" (max 2 cisterne)

**Cisterne**:
- TR001 "Cisterna 1" - 17.500L
- TR002 "Cisterna 2" - 17.500L
- TR003 "Cisterna 3" - 17.500L

**Autisti**:
- Mario Rossi (RESIDENT) - patentini validi 1 anno
- Giuseppe Verdi (ON_CALL) - €25/ora
- Luigi Bianchi (RESIDENT)

---

## Note per Sviluppo Futuro

### Funzionalità non ancora implementate
- Autenticazione utenti (JWT predisposto ma non attivo)
- Notifiche push per alert
- Mappa interattiva per luoghi
- Drag & drop viaggi nel calendario
- Import/export pianificazioni
- Multi-tenant (più aziende)

### Configurazioni
- `ORS_API_KEY`: Chiave OpenRouteService per calcolo percorsi reali
- Senza chiave, usa stima basata su distanza lineare × 1.3

### Porte
- Frontend: 5174
- Backend: 3001
- PostgreSQL: 5432
