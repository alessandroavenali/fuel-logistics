# Changelog

Tutte le modifiche rilevanti al progetto Fuel Logistics Management System saranno documentate in questo file.

Il formato segue [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

## [1.10.0] - 2026-01-27

### Corretto

#### Backend - Optimizer Disponibilità Autisti

- **Bug autisti ON_CALL e EMERGENCY non considerati nel calcolo MAX** (`src/services/optimizer.service.ts`)
  - Prima: gli autisti EMERGENCY venivano sempre esclusi (hard-coded), anche se con disponibilità configurata
  - Ora: se un autista (ON_CALL o EMERGENCY) ha disponibilità esplicitamente configurata, viene usato

- **Bug driver Livigno faceva SUPPLY invece di SHUTTLE**
  - Prima: Marco (driver Livigno) poteva sprecare tempo facendo SUPPLY (6h) invece di aspettare cisterne
  - Ora: driver Livigno fa SOLO SHUTTLE, aspetta le cisterne piene (può fare 3 SHUTTLE/giorno = 52.500L)

- **Bug driver Tirano non faceva SHUTTLE dopo SUPPLY**
  - Prima: dopo il SUPPLY, i driver provavano a fare un altro SUPPLY invece di SHUTTLE
  - Ora: logica corretta che considera le ore già lavorate prima di decidere SUPPLY vs SHUTTLE

- **Ottimizzato bilanciamento SUPPLY paralleli**
  - Driver che non possono fare SUPPLY+SHUTTLE (9.5h) per vincoli ADR ora fanno comunque SUPPLY
  - Le cisterne saranno disponibili per altri driver o per il giorno successivo

### Migliorato

- **Logica default disponibilità autisti allineata frontend/backend**
  - Se specifico disponibilità: usa SOLO i driver con date specificate
  - RESIDENT non in lista: disponibili tutti i giorni (default)
  - ON_CALL/EMERGENCY non in lista: NON disponibili (devono essere attivati esplicitamente)

### Esempio Risultati

| Configurazione | Litri/settimana |
|----------------|-----------------|
| Solo 3 RESIDENT | 280.000L |
| +1 ON_CALL (Gio-Ven) | 332.500L (+52.500L) |
| +1 EMERGENCY (Ven) | 350.000L (+70.000L vs base) |

---

## [1.9.0] - 2026-01-27

### Aggiunto

#### Frontend

- **Toggle "Includi weekend"** (`src/pages/Schedules.tsx`)
  - Nuovo switch per abilitare pianificazione anche nei giorni di sabato e domenica
  - Posizionato sotto i campi data nel dialog di creazione pianificazione
  - Descrizione: "Abilita per periodi eccezionali con consegne sabato/domenica"
  - Default: disabilitato (solo Lun-Ven come prima)

- **Griglia disponibilità autisti estesa**
  - Quando il weekend è abilitato, la griglia mostra anche Sab e Dom
  - Gestione disponibilità completa 7 giorni su 7 per periodi eccezionali

- **Preview capacità massima migliorata**
  - Mostra "(weekend incluso)" quando il toggle è attivo
  - Calcolo corretto considera tutti i 7 giorni

- **API Client** (`src/api/client.ts`)
  - `CalculateMaxInput` esteso con campo opzionale `includeWeekend`

#### Backend

- **Schema Database** (`prisma/schema.prisma`)
  - Nuovo campo `includeWeekend` (Boolean, default false) nel modello Schedule
  - Permette di salvare la preferenza per ogni pianificazione

- **Optimizer Service** (`src/services/optimizer.service.ts`)
  - `CalculateMaxInput` esteso con campo `includeWeekend`
  - `getWorkingDays()` ora accetta parametro `includeWeekend`
  - L'optimizer considera tutti i giorni quando `includeWeekend` è true

- **Validatore** (`src/utils/validators.ts`)
  - `createScheduleSchema` accetta campo opzionale `includeWeekend`

- **Controller** (`src/controllers/schedules.controller.ts`)
  - `calculateMaxCapacityHandler` passa `includeWeekend` al servizio

### Corretto

- **Bug calcolo MAX ignorava weekend**: lo schedule temporaneo usato per il calcolo non passava `includeWeekend`, causando risultati identici con/senza weekend

### Flusso Utente

1. Apri dialog "Nuova Pianificazione"
2. Seleziona date inizio/fine
3. (Opzionale) Attiva toggle **"Includi weekend"** per periodi eccezionali
4. La griglia disponibilità autisti mostra ora anche Sab e Dom
5. Configura disponibilità autisti (es. alcuni disponibili nel weekend, altri no)
6. Click **MAX** → calcolo considera tutti i giorni selezionati
7. Crea pianificazione con flag `includeWeekend` salvato

### Esempio

| Scenario | Giorni | Risultato MAX |
|----------|--------|---------------|
| Settimana normale (Lun-Ven) | 5 | 367.500L |
| Settimana con weekend | 7 | ~514.500L |
| Solo weekend (Sab-Dom) | 2 | ~147.000L |

---

## [1.8.0] - 2026-01-27

### Aggiunto

#### Frontend

- **Gestione Disponibilità Autisti** (`src/pages/Schedules.tsx`)
  - Nuova sezione "Disponibilità Autisti" nel dialog creazione pianificazione
  - Griglia checkbox per ogni giorno lavorativo, organizzata per settimana
  - Default intelligente basato sul tipo autista:
    - **RESIDENT (Dipendente)**: tutti i giorni selezionati
    - **ON_CALL (A chiamata)**: nessun giorno selezionato
    - **EMERGENCY (Emergenza)**: nessun giorno selezionato
  - Pulsanti "Tutti" e "Nessuno" per selezione rapida per ogni autista
  - Badge colorati per tipo autista (verde/giallo/rosso)
  - Scroll area con max-height per gestire molti autisti
  - Validazione: almeno un autista disponibile per almeno un giorno

- **Componente Checkbox** (`src/components/ui/checkbox.tsx`)
  - Nuovo componente checkbox accessibile con supporto `aria-checked`
  - Stile coerente con il design system esistente

- **Tipi TypeScript** (`src/types/index.ts`)
  - `DriverDayAvailability`: disponibilità singolo giorno
  - `DriverAvailabilityInput`: formato input API con array date

- **API Client** (`src/api/client.ts`)
  - `DriverAvailabilityInput`: interfaccia per payload
  - `CalculateMaxInput` esteso con campo `driverAvailability`

- **Helper Functions** (`src/pages/Schedules.tsx`)
  - `getWorkingDaysBetween()`: genera giorni lavorativi (Lun-Ven) tra due date
  - `getDefaultAvailability()`: inizializza disponibilità default per tipo driver
  - `formatDayShort()`: formatta data come "Lun 3"
  - `groupDaysByWeek()`: raggruppa giorni per settimana
  - `getDriverTypeLabel()`: traduzione tipo driver (Dipendente/A chiamata/Emergenza)
  - `getDriverTypeBadgeColor()`: colori badge per tipo

#### Backend

- **Optimizer Service** (`src/services/optimizer.service.ts`)
  - Nuovo tipo `DriverAvailabilityInput` per disponibilità driver
  - `CalculateMaxInput` esteso con campo opzionale `driverAvailability`
  - `optimizeSchedule()` ora accetta parametro opzionale `driverAvailability`
  - Filtro driver per giorno: solo driver disponibili in quella data vengono considerati
  - `calculateMaxCapacity()` valida e passa disponibilità all'optimizer

- **Controller** (`src/controllers/schedules.controller.ts`)
  - `calculateMaxCapacityHandler` ora accetta `driverAvailability` nel body
  - Log esteso per debug con conteggio driver disponibili

### Flusso Utente

1. Apri dialog "Nuova Pianificazione"
2. Seleziona date inizio/fine → griglia disponibilità autisti appare
3. Sistema inizializza disponibilità:
   - Dipendenti: tutti i giorni lavorativi selezionati
   - A chiamata/Emergenza: nessun giorno selezionato
4. (Opzionale) Modifica disponibilità:
   - Deseleziona giorni per autisti in malattia/ferie
   - Seleziona giorni per attivare autisti a chiamata
   - Usa "Tutti" / "Nessuno" per selezione rapida
5. Click **MAX** → calcolo considera solo autisti disponibili per ogni giorno
6. Risultato riflette la capacità reale con la forza lavoro configurata

### Esempio

| Scenario | Risultato MAX |
|----------|---------------|
| 3 dipendenti tutti disponibili | 367.500L (5 giorni) |
| 1 dipendente in malattia mercoledì | ~330.000L |
| Solo 1 dipendente disponibile | ~175.000L |
| Aggiungi 1 a chiamata per 3 giorni | +52.500L |

---

## [1.7.0] - 2026-01-26

### Migliorato

#### Backend - Optimizer più intelligente

- **Tracking cisterne a Livigno** (`src/services/optimizer.service.ts`)
  - Aggiunto `atLivignoFull` e `atLivignoEmpty` allo stato cisterne
  - L'optimizer ora traccia le cisterne in tutte le location (Tirano, Livigno, Milano)
  - Gestione corretta dello stato iniziale per location tipo `DESTINATION`

- **Driver Livigno possono fare SUPPLY** (`src/services/optimizer.service.ts`)
  - Prima: driver Livigno potevano solo fare SHUTTLE
  - Ora: se non ci sono cisterne piene da shuttlare, possono fare SUPPLY
  - Usano cisterne vuote da Livigno o Tirano per andare a Milano
  - Risultato: +10% capacità (da 332.500L a 367.500L su 5 giorni)

- **SUPPLY e FULL_ROUND usano cisterne da Livigno**
  - I viaggi SUPPLY ora prendono vuote sia da Tirano che da Livigno
  - FULL_ROUND considera anche cisterne vuote a Livigno
  - Massimizza utilizzo risorse disponibili

- **Validazione initialStates** (`src/services/optimizer.service.ts`)
  - Valida gli ID di trailers e locations prima di crearli nel DB
  - Filtra automaticamente stati con ID non validi
  - Evita errori di foreign key constraint

#### Frontend

- **Default cisterne corretto** (`src/pages/Schedules.tsx`)
  - Prima: default era "tutte a Livigno vuote" (causava 0 viaggi)
  - Ora: default è "tutte a Tirano vuote" (stato normale di partenza)

### Corretto

- **Bug 0 litri quando cisterne a Livigno**
  - L'optimizer generava 0 viaggi se tutte le cisterne erano a Livigno
  - Ora gestisce correttamente qualsiasi stato iniziale

---

## [1.6.0] - 2026-01-26

### Aggiunto

#### Backend

- **Funzione `calculateMaxCapacity()`** (`src/services/optimizer.service.ts`)
  - Calcola la capacità massima di consegna carburante per un periodo
  - Input: `startDate`, `endDate`, `initialStates` (stato iniziale cisterne)
  - Output: `maxLiters`, `workingDays`, `dailyCapacity`, `breakdown`, `constraints`
  - Considera vincoli:
    - Driver Livigno: max 3 shuttle/giorno × 17.500L = 52.500L/driver
    - Driver Tirano: 2 shuttle/giorno (1 dedicato a SUPPLY per rifornimento)
    - Ciclo cisterne: bilancia consumo vs rifornimento
    - Veicoli: max 2 viaggi/giorno per veicolo
    - Ore ADR: max 9h/giorno per driver

- **Tipi TypeScript** (`src/services/optimizer.service.ts`)
  - `MaxCapacityResult`: risultato calcolo con breakdown e vincoli
  - `CalculateMaxInput`: parametri input per il calcolo

- **Handler `calculateMaxCapacityHandler()`** (`src/controllers/schedules.controller.ts`)
  - Valida input (startDate, endDate obbligatori)
  - Chiama `calculateMaxCapacity()` e ritorna risultato JSON

- **Endpoint `POST /api/schedules/calculate-max`** (`src/routes/index.ts`)
  - Nuovo endpoint per calcolo capacità massima
  - Posizionato prima delle route con parametro `:id` per evitare conflitti

#### Frontend

- **Tipi API** (`src/api/client.ts`)
  - `MaxCapacityResult`: interfaccia risultato calcolo
  - `CalculateMaxInput`: interfaccia parametri input
  - Metodo `schedulesApi.calculateMax()`: chiamata endpoint

- **Hook `useCalculateMaxCapacity()`** (`src/hooks/useSchedules.ts`)
  - Mutation hook per calcolo capacità massima
  - Ritorna `mutateAsync` per chiamata asincrona

- **Pulsante MAX** (`src/pages/Schedules.tsx`)
  - Pulsante con icona Zap accanto al campo "Litri Richiesti"
  - Stato loading con spinner durante calcolo
  - Validazione: richiede date selezionate prima di calcolare

- **Dialog Preview Capacità Massima** (`src/pages/Schedules.tsx`)
  - Mostra risultato calcolo in formato visuale:
    - Litri totali in grande (es. "600.000L")
    - Giorni lavorativi e capacità giornaliera
    - Breakdown viaggi per tipo (Shuttle Livigno/Tirano, Supply, Full Round)
    - Note e vincoli con bullet point gialli
  - Pulsanti "Annulla" e "Usa questo valore"

- **Funzione `handleConfirmMax()`** (`src/pages/Schedules.tsx`)
  - Imposta `requiredLiters` con valore calcolato
  - Auto-genera nome pianificazione se vuoto (es. "MAX 1 feb - 7 feb")
  - Toast di conferma con riepilogo

### Flusso Utente

1. Apri dialog "Nuova Pianificazione"
2. Seleziona date inizio/fine
3. (Opzionale) Configura stato iniziale cisterne
4. Click su **MAX** → chiamata API
5. Dialog preview mostra "Capacità massima: 600.000L in 5 giorni"
6. Click "Usa questo valore" → imposta litri e nome
7. Click "Crea" → schedule creato pronto per ottimizzazione

### Calcolo Teorico

| Risorsa | Capacità/giorno |
|---------|-----------------|
| 1 Driver Livigno (3 shuttle) | 52.500L |
| 3 Driver Tirano (2 shuttle) | 105.000L |
| -1 Driver Tirano (supply) | -35.000L (rifornisce deposito) |
| **TOTALE STIMATO** | **~120.000L/giorno** |

---

## [1.5.0] - 2026-01-26

### Aggiunto

#### Backend

- **Enum TripType** (`prisma/schema.prisma`)
  - `SHUTTLE_LIVIGNO`: Tirano ↔ Livigno, 3.5h, 1 cisterna, 17.500L
  - `SUPPLY_MILANO`: Tirano ↔ Milano, 6h, 2 cisterne, riempie deposito Tirano
  - `FULL_ROUND`: Percorso completo, 8h, 1 cisterna, 17.500L

- **Base Operativa Driver** (`prisma/schema.prisma`)
  - Nuovo campo `baseLocationId` in model Driver
  - Relazione `baseLocation` con Location
  - Relazione inversa `driversWithBase` in Location

- **Campo tripType in Trip** (`prisma/schema.prisma`)
  - Tipo viaggio assegnato dall'ottimizzatore
  - Default: FULL_ROUND

- **Nuovo Algoritmo Ottimizzatore** (`src/services/optimizer.service.ts`)
  - Supporto 3 tipi di viaggio con durate e cisterne specifiche
  - Gestione stato cisterne: `atTiranoFull`, `atTiranoEmpty`, `atMilano`
  - Driver Livigno: priorità massima, max 3 shuttle/giorno (52.500L)
  - Driver Tirano: bilanciamento automatico SUPPLY vs SHUTTLE
  - Statistiche `tripsByType` nel risultato ottimizzazione

- **Tempistiche Aggiornate** (`prisma/seed.ts`)
  - Tirano ↔ Livigno: 90 min (era 120 min)
  - Tirano ↔ Milano: 150 min (era 180 min)

- **Validatori Estesi** (`src/utils/validators.ts`)
  - `TripTypeEnum` per validazione tipo viaggio
  - `baseLocationId` in createDriverSchema

#### Frontend

- **Tipo TripType** (`src/types/index.ts`)
  - Tipo TypeScript per i 3 tipi di viaggio
  - Aggiornate interfacce Driver (baseLocationId, baseLocation) e Trip (tripType)

- **Selezione Base Operativa** (`src/pages/Drivers.tsx`)
  - Nuovo campo "Base Operativa" nel form autista
  - Dropdown con Tirano e Livigno
  - Colonna "Base" nella tabella autisti

- **Badge Tipo Viaggio** (`src/pages/ScheduleDetail.tsx`)
  - Badge colorati: Shuttle (verde), Rifornimento (blu), Completo (viola)
  - Mostrati in header dettaglio e riepilogo viaggio

- **Timeline per Tipo Viaggio** (`src/pages/ScheduleDetail.tsx`)
  - SHUTTLE_LIVIGNO: 5 step (Tirano → Livigno → Tirano)
  - SUPPLY_MILANO: 6 step (Tirano → Milano → Tirano)
  - FULL_ROUND: 9 step (Tirano → Milano → Tirano → Livigno → Tirano)

### Modificato

- **Seed Data**: Driver con baseLocationId assegnato
  - Marco Bianchi → Livigno (unico driver, max 3 shuttle/giorno)
  - Altri 4 driver → Tirano

- **Controller Drivers**: Include `baseLocation` nelle query getDrivers e getDriver

### Capacità Sistema

| Scenario | Litri/giorno |
|----------|--------------|
| 1 driver Livigno (3 shuttle) | 52.500L |
| 2 driver Tirano (shuttle) | 35.000L |
| 1 driver Tirano (supply) | riempie deposito |
| **TOTALE** | **~120.000L/giorno** |

**Miglioramento rispetto a versione precedente: +70% capacità**

---

## [1.4.0] - 2026-01-25

### Modificato

#### Frontend

- **Calendario Pianificazione** - Redesign completo (`src/pages/ScheduleDetail.tsx`)
  - Sostituito `react-big-calendar` con nuovo componente `DriverTimeline`
  - Vista a "swim lanes" con una riga dedicata per ogni autista
  - Risolto problema di sovrapposizione eventi (4+ viaggi paralleli ora leggibili)
  - Altezza calendario aumentata da 350px a 500px
  - Navigazione giornaliera con frecce e pillole per i giorni della settimana
  - Scroll orizzontale per visualizzare tutte le ore (05:00 - 22:00)
  - Barre colorate per stato viaggio:
    - Blu = Pianificato
    - Viola = In corso
    - Verde = Completato
    - Rosso = Annullato
  - Click su barra per vedere dettaglio viaggio
  - Click su slot vuoto (in DRAFT) per creare viaggio pre-compilato con driver e orario
  - Legenda stati in fondo al calendario

### Aggiunto

#### Frontend

- **Componente DriverTimeline** (`src/components/calendar/DriverTimeline.tsx`)
  - Componente riutilizzabile per visualizzazione timeline per risorsa
  - Props: trips, drivers, startDate, endDate, callbacks
  - Supporto selezione viaggio e creazione da slot
  - Responsive con scroll orizzontale

---

## [1.3.0] - 2026-01-25

### Aggiunto

#### Backend

- **Modello ScheduleInitialState** (`prisma/schema.prisma`)
  - Nuovo modello per memorizzare lo stato iniziale delle cisterne per ogni pianificazione
  - Campi: `scheduleId`, `trailerId`, `locationId`, `isFull`
  - Vincolo unico su `[scheduleId, trailerId]` per evitare duplicati
  - Relazioni inverse in `Schedule`, `Trailer`, e `Location`

- **API Initial States** (`src/controllers/schedules.controller.ts`)
  - `createSchedule`: accetta `initialStates` array per creare stati iniziali cisterne
  - `getSchedule`: include `initialStates` con relazioni `trailer` e `location`
  - `updateSchedule`: supporta aggiornamento stati iniziali (delete + create in transazione)

- **Validatore esteso** (`src/utils/validators.ts`)
  - `createScheduleSchema` ora accetta campo opzionale `initialStates` con array di `{trailerId, locationId, isFull}`

- **Ottimizzatore migliorato** (`src/services/optimizer.service.ts`)
  - Nuovo campo `trailerIsFull` nel tracker per tracciare stato piena/vuota
  - Lettura stati iniziali dalla pianificazione al momento dell'ottimizzazione
  - Inizializzazione posizioni cisterne da stati iniziali (default: sorgente, vuota)
  - `findAvailableTrailers` ora prioritizza cisterne piene al parcheggio

#### Frontend

- **Componente Switch** (`src/components/ui/switch.tsx`)
  - Nuovo componente toggle per il selettore piena/vuota

- **Dialog Nuova Pianificazione** (`src/pages/Schedules.tsx`)
  - Sezione "Condizioni Iniziali Cisterne" dopo i litri richiesti
  - Per ogni cisterna attiva: dropdown posizione + toggle piena/vuota
  - Default: Livigno (DESTINATION), vuota
  - Invio `initialStates` nella creazione pianificazione

- **Dettaglio Pianificazione** (`src/pages/ScheduleDetail.tsx`)
  - Card "Condizioni Iniziali Cisterne" visibile se presenti stati iniziali
  - Mostra nome/targa cisterna, posizione, stato piena/vuota con badge colorati

- **Tipi TypeScript** (`src/types/index.ts`)
  - Interface `ScheduleInitialState` con relazioni opzionali
  - `CreateScheduleInput` esteso con campo `initialStates`
  - `Schedule` esteso con campo `initialStates`

### Modificato

- **Logica ottimizzatore**: le cisterne ora partono dalle posizioni iniziali specificate invece che tutte dalla sorgente

---

## [1.2.0] - 2026-01-25

### Aggiunto

#### Frontend

- **Pannello Dettaglio Viaggio** (`src/pages/ScheduleDetail.tsx`)
  - Layout split-view: calendario sopra (compatto), dettaglio sotto
  - Click su evento calendario → mostra pannello dettaglio (no più modal)
  - Colonna sinistra: info viaggio (autista, motrice, cisterne con badge pickup/sgancio)
  - Colonna destra: cronologia viaggio con timeline visuale

- **Cronologia Viaggio con Timeline**
  - Timeline verticale con tutte le tappe del viaggio
  - Orari calcolati automaticamente dai percorsi configurati
  - Icone colorate per tipo azione: partenza, arrivo, carico, scarico, sgancio, pickup
  - **Icone cisterne piene/vuote**: rettangoli con bordo grigio (vuota) o ambra con pallino (piena)
  - Legenda visuale in fondo alla timeline

- **Flusso Operativo Corretto**
  - Base operativa = Livigno (non Milano)
  - Vincolo montagna: Livigno ↔ Tirano max 1 cisterna
  - Timeline mostra: partenza Livigno con 1 cisterna → aggancio 2° a Tirano → Milano → ritorno

### Modificato

- **Calendario** ridotto a 350px di altezza per fare spazio al pannello dettaglio
- **Dialog viaggio** semplificato: solo per creazione/modifica, senza timeline
- **Documentazione** (`DOCS.md`) aggiornata con flusso operativo corretto

### Corretto

- **Bug timeline**: ora mostra correttamente 1 cisterna alla partenza da Livigno (vincolo montagna)
- **Unused variables**: rimossi warning TypeScript per variabili non utilizzate

---

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

- **PostgreSQL 15+** (locale via Homebrew)
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
└── start.sh                   # Script avvio
```

### Note Tecniche

- Il calendario usa `react-big-calendar` con localizzazione italiana
- I grafici sono implementati con `recharts`
- La validazione form usa `react-hook-form` + `zod`
- L'ottimizzatore considera la capacita cisterna standard di 17.500L
- Il tempo medio viaggio Milano-Livigno e stimato in 8 ore A/R
