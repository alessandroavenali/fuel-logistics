# Problema: Algoritmo di Ottimizzazione non Scala con Giorni Driver Aggiuntivi

## Contesto

Sistema di logistica carburante Livigno. L'optimizer calcola il MAX di litri consegnabili in un periodo.

### Risorse
- **Motrici**: 4 (1 a Livigno, 3 a Tirano), con cisterna integrata 17.500L
- **Rimorchi**: 4 a Tirano, 17.500L ciascuno (NON salgono a Livigno)
- **Driver**: RESIDENT (lavorano sempre), ON_CALL (giorni specifici)

### Tipi di Viaggio
| Tipo | Durata | Effetto |
|------|--------|---------|
| SUPPLY | 6h (Tirano) / 10h (Livigno) | Crea: 1 motrice piena + 1 rimorchio pieno |
| TRANSFER | 0.5h | Converte: rimorchio pieno → motrice piena |
| SHUTTLE | 4.5h | Consuma: 1 motrice piena. **Consegna: 17.500L** |
| FULL_ROUND | 9h | Indipendente. **Consegna: 17.500L** |

### Vincoli ADR
- Max 9h/giorno (estendibile a 10h, max 2x/settimana)

## Il Problema

Aggiungere giorni di disponibilità per un driver ON_CALL **non aumenta proporzionalmente** il MAX calcolato.

### Esempio Concreto (Marco RESIDENT 5gg + Giovanni ON_CALL)

| Giovanni disponibile | MAX Litri | Incremento |
|---------------------|-----------|------------|
| 1 giorno | 105.000L | baseline |
| 2 giorni | 105.000L | **+0L** ❌ |
| 3 giorni | 122.500L | +17.500L |
| 4 giorni | 157.500L | +35.000L |
| 5 giorni | 157.500L | **+0L** ❌ |

**Atteso**: ogni giorno aggiuntivo dovrebbe aggiungere ~17.500-35.000L

## Causa Root

L'algoritmo è **greedy** (decide giorno per giorno):

```
Per ogni giorno:
  Per ogni driver disponibile:
    Se motrice piena → SHUTTLE
    Altrimenti se rimorchio pieno → TRANSFER
    Altrimenti → SUPPLY
```

### Cosa Succede con Giovanni 2 Giorni

**Giorno 1**: Marco SUPPLY, Giovanni SUPPLY+TRANSFER → 3 motrici piene, 1 rimorchio pieno

**Giorno 2**:
- Marco: 2 SHUTTLE (35.000L)
- Giovanni: 2 SHUTTLE (35.000L)
- **Totale: 70.000L** ma **consuma TUTTE le risorse**

**Giorni 3-5**: Marco deve rifare SUPPLY, poi SHUTTLE
- Risultato: +35.000L

**Totale: 105.000L**

### Cosa Succede con Giovanni 1 Giorno

**Giorno 1**: Marco SUPPLY, Giovanni SUPPLY+TRANSFER → 3 motrici piene, 1 rimorchio pieno

**Giorno 2**: Marco 2 SHUTTLE (35.000L), rimangono risorse

**Giorno 3**: Marco 2 SHUTTLE (35.000L) con risorse rimanenti

**Giorni 4-5**: Marco FULL_ROUND×2 (35.000L)

**Totale: 105.000L** (uguale!)

## Perché il Greedy Fallisce

Giovanni giorno 2 fa SHUTTLE che **consumano risorse che Marco avrebbe usato nei giorni successivi**. Il greedy non "vede" che:
- Fare SUPPLY oggi crea risorse per domani
- Fare SHUTTLE oggi consuma risorse che servirebbero domani

## Soluzioni Provate (Fallite)

1. **ON_CALL fa SUPPLY invece di SHUTTLE** → Peggiora perché crea risorse inutilizzate
2. **Limitare SHUTTLE per ON_CALL** → Non risolve il bilanciamento
3. **Multi-strategia** (prova N configurazioni) → Stesso risultato, il greedy è il limite
4. **Gestione estensioni ADR** → Migliora ma non risolve

## Soluzione Richiesta

Un algoritmo che **pianifica l'intero periodo insieme**, non giorno per giorno:

1. Calcola budget totale ore-driver
2. Determina quanti SUPPLY servono per creare risorse
3. Determina quanti SHUTTLE possiamo fare con quelle risorse
4. Distribuisce SUPPLY nei primi giorni, SHUTTLE negli ultimi
5. Garantisce che **aggiungere giorni-driver non peggiori MAI** il risultato

### Formula Teorica

Per un driver Tirano, il ciclo ottimale in 2 giorni:
- Giorno 1: SUPPLY (6h) → crea risorse
- Giorno 2: SHUTTLE + TRANSFER + SHUTTLE (9.5h) → 35.000L

**Capacità teorica**: `(giorni_driver / 2) × 35.000L`

Ma servono risorse PRIMA di poterle usare, quindi il primo giorno deve sempre essere SUPPLY.

## File Rilevanti

- `backend/src/services/optimizer.service.ts` - Algoritmo attuale (greedy)
- `backend/src/services/optimizer-global.service.ts` - Bozza algoritmo globale (incompleto)

## Test per Verificare la Soluzione

```bash
# Con Giovanni ON_CALL disponibile N giorni, il MAX deve crescere monotonicamente
curl -X POST http://localhost:3002/api/schedules/calculate-max \
  -H "Content-Type: application/json" \
  -d '{
    "startDate": "2026-02-02",
    "endDate": "2026-02-08",
    "driverAvailability": [
      {"driverId": "MARCO_ID", "availableDates": ["2026-02-02","2026-02-03","2026-02-04","2026-02-05","2026-02-06"]},
      {"driverId": "GIOVANNI_ID", "availableDates": ["2026-02-02","2026-02-03"]}  // Variare questo
    ]
  }'
```

Risultato atteso: `1gg < 2gg < 3gg < 4gg < 5gg` (crescita monotona)
