# Piano Ottimizzato Trasporto Carburante Milano → Livigno

## 5 giorni lavorativi (Lun-Ven)

---

## Legenda Operazioni

| Operazione | Percorso | Guida | Calendario | Effetto |
|------------|----------|-------|------------|---------|
| SUPPLY | Tirano→Milano→Tirano | 5h | 5h45 | +1 mot piena +1 rim pieno |
| SHUTTLE | Tirano→Livigno→Tirano | 3.5h | 4h15 | 17.500L consegnati |
| TRANSFER | Rimorchio→Motrice | 0h | 0h30 | Travaso carburante |
| FULL_ROUND | Tirano→Milano→Livigno→Tirano | 8.5h | 10h | 17.500L + 1 rim pieno |
| L1 ADR | Livigno→Milano→Livigno | 8.5h | 9h15 | 17.500L + 1 rim (domani) |
| L1 SHUTTLE | Livigno→Tirano→Livigno | 3.5h | 4h30 | 17.500L (usa rim esistente) |

**Risorse:** 3 motrici Tirano (T1-T3) | 1 motrice Livigno (L1) | 4 rimorchi

**Vincoli:** Max 9h guida/giorno | Dogana Livigno chiude 18:30 | ADR: max 2/settimana

---

## LUNEDÌ (Giorno 1)

### Risultato: 105.000L (6 consegne)

| Ora | Driver | Operazione | Note |
|-----|--------|------------|------|
| 06:00 | L1 | Parte ADR LOOP | Livigno→Tirano→Milano→Tirano→Livigno |
| 06:00 | T1, T2, T3 | Partono SUPPLY | Tirano→Milano→Tirano |
| 06:00 | T4 | Aspetta | Non ci sono motrici disponibili |
| 07:30 | L1 | Arriva Tirano | 90 min discesa |
| 08:30 | T1,T2,T3 | Arrivano Milano | 150 min |
| 09:15 | T1,T2,T3 | Carico Milano | 45 min pausa/carico |
| 10:00 | L1 | Arriva Milano | 150 min da Tirano |
| 10:00 | T1,T2,T3 | Ripartono | Con motrici + rimorchi PIENI |
| 10:45 | L1 | Carico Milano | 45 min |
| 11:30 | L1 | Riparte | Verso Tirano |
| 11:45 | T1,T2,T3 | Arrivano Tirano | **3 mot piene + 3 rim pieni** |
| 11:45 | T1 | SHUTTLE #1 | → Livigno |
| 11:45 | T2 | SHUTTLE #2 | → Livigno |
| 11:45 | T3 | SHUTTLE #3 | → Livigno |
| 11:45 | T4 | TRANSFER | Rimorchio #1 → motrice (30 min) |
| 12:15 | T4 | SHUTTLE #4 | → Livigno |
| 13:45 | T1,T2,T3 | Arrivano Livigno | **CONSEGNA 52.500L** |
| 14:00 | L1 | Arriva Tirano | Lascia rimorchio pieno |
| 14:15 | T4 | Arriva Livigno | **CONSEGNA 17.500L** |
| 14:30 | T1,T2,T3 | Ripartono | 45 min scarico/pausa |
| 15:00 | T4 | Riparte | Da Livigno |
| 15:15 | L1 | Arriva Livigno | **CONSEGNA 17.500L** (ADR completato) |
| 16:00 | T1,T2,T3 | Tornano Tirano | Con motrici VUOTE |
| 16:00 | T1 | TRANSFER | Rimorchio #2 → motrice |
| 16:00 | T2 | TRANSFER | Rimorchio #3 → motrice |
| 16:30 | T1 | SHUTTLE #5 | → Livigno (ultimo!) |
| 16:30 | T4 | Torna Tirano | - |
| 18:30 | T1 | Arriva Livigno | **CONSEGNA 17.500L** (dogana!) |

### Ore guida
- L1: █████████ 9h
- T1: █████████ 8.5h
- T2: █████████ 8.5h
- T3: █████████ 8.5h
- T4: ███████░░ 7h

### Stato fine giornata
- 1 motrice piena (T2)
- 0 rimorchi pieni (L1 rimorchio disponibile domani)

---

## MARTEDÌ (Giorno 2)

### Risultato: 105.000L (6 consegne)

| Ora | Evento |
|-----|--------|
| 06:00 | L1 parte ADR LOOP #2 (ultima eccezione settimanale) |
| 06:00 | T1, T2 partono SUPPLY (2 motrici disponibili, 1 già piena da ieri) |
| 06:00 | T3, T4 aspettano risorse |
| 11:45 | T1, T2 tornano con 2 mot + 2 rim pieni. Totale: 3 mot piene, 3 rim pieni |
| 11:45+ | 5 SHUTTLE (T1,T2,T3 con mot, T4 dopo transfer) = **87.500L** |
| 15:15 | L1 completa ADR = **17.500L** |

**TOTALE: 6 consegne = 105.000L**

### Ore guida
- L1: █████████ 9h
- T1: █████████ 8.5h
- T2: █████░░░░ 5h
- T3: ███████░░ 7h
- T4: ███████░░ 7h

---

## MERCOLEDÌ (Giorno 3)

### Risultato: 105.000L (6 consegne)

| Ora | Evento |
|-----|--------|
| 06:00 | T1, T2 partono SUPPLY (1 mot già piena da ieri + rimorchio da L1) |
| 06:00 | T3, T4 aspettano risorse |
| 11:45 | T1, T2 tornano. Totale: 3 mot piene, 3 rim pieni |
| 11:45+ | 5 SHUTTLE da Tirano = **87.500L** |
| 11:45 | L1 aspetta rimorchio pieno a Tirano |
| 12:00 | L1 parte SHUTTLE (usa rimorchio) = **17.500L** |

**TOTALE: 6 consegne = 105.000L**

> **NOTA:** L1 non usa ADR (eccezioni esaurite), fa solo SHUTTLE con rimorchi esistenti

### Ore guida
- L1: ████░░░░░ 3.5h
- T1: █████████ 8.5h
- T2: █████░░░░ 5h
- T3: ███████░░ 7h
- T4: ███████░░ 7h

---

## GIOVEDÌ (Giorno 4)

### Risultato: 105.000L (6 consegne)

| Ora | Evento |
|-----|--------|
| 06:00 | T1, T2, T3 partono SUPPLY (tutte motrici vuote da ieri) |
| 06:00 | T4 aspetta |
| 11:45 | Tornano con 3 mot + 3 rim pieni |
| 11:45+ | 5 SHUTTLE da Tirano = **87.500L** |
| 12:00 | L1 parte SHUTTLE = **17.500L** |

**TOTALE: 6 consegne = 105.000L**

### Ore guida
- L1: ████░░░░░ 3.5h
- T1: █████████ 8.5h
- T2: █████████ 8.5h
- T3: █████████ 8.5h
- T4: ███████░░ 7h

---

## VENERDÌ (Giorno 5) - ULTIMO GIORNO

### Risultato: 105.000L (6 consegne)

| Ora | Evento |
|-----|--------|
| 06:00 | **NESSUN SUPPLY** (ultimo giorno, non servono risorse per domani) |
| 06:00 | T1, T2, T3 partono FULL_ROUND (Milano→Livigno diretto) = **52.500L** |
| 06:00 | T4 fa TRANSFER (rimorchio da giovedì) + 1 SHUTTLE = **17.500L** |
| 06:00 | L1 aspetta rimorchi a Tirano |
| ~12:00 | L1 fa 2× SHUTTLE (usa rimorchi da FULL_ROUND) = **35.000L** |

**TOTALE: 6 consegne = 105.000L**

> **NOTA:** Niente si spreca! Tutti i rimorchi prodotti da FULL_ROUND usati da L1

### Ore guida
- L1: ███████░░ 7h
- T1: █████████ 8.5h
- T2: █████████ 8.5h
- T3: █████████ 8.5h
- T4: ████░░░░░ 3.5h

---

## Riepilogo Settimanale

|              | LUNEDÌ | MARTEDÌ | MERCOLEDÌ | GIOVEDÌ | VENERDÌ | **TOTALE** |
|--------------|--------|---------|-----------|---------|---------|------------|
| **LITRI**    | 105.000 | 105.000 | 105.000 | 105.000 | 105.000 | **525.000** |
| **CONSEGNE** | 6 | 6 | 6 | 6 | 6 | **30** |
| SUPPLY       | 3 | 2 | 2 | 3 | 0 | 10 |
| SHUTTLE      | 5 | 5 | 5 | 5 | 1 | 21 |
| TRANSFER     | 3 | 3 | 2 | 2 | 1 | 11 |
| FULL_ROUND   | 0 | 0 | 0 | 0 | 3 | 3 |
| L1 ADR       | 1 | 1 | 0 | 0 | 0 | 2 |
| L1 SHUTTLE   | 0 | 0 | 1 | 1 | 2 | 4 |

---

## Statistiche Efficienza

| Metrica | Valore |
|---------|--------|
| Utilizzo medio driver Tirano | 7.4h/giorno (82% del max 9h) |
| Utilizzo medio L1 | 5.7h/giorno (63% del max 9h) |
| Eccezioni ADR usate | 2/2 (100%) |
| Motrici inutilizzate fine settimana | 0 |
| Rimorchi inutilizzati fine settimana | 0 |

---

## Percorsi e Tempi

```
MILANO ←── 150 min ──→ TIRANO ←── 120 min (salita) ──→ LIVIGNO
  │                      │          90 min (discesa)       │
DEPOSITO              PARCHEGGIO                      DESTINAZIONE
CARBURANTE            RIMORCHI                        FINALE
```

## Capacità Mezzi

- **Motrice** (serbatoio integrato): 17.500 litri
- **Rimorchio**: 17.500 litri
- **Combinazione massima**: 35.000 litri per viaggio

> **NOTA:** I rimorchi NON salgono MAI a Livigno. Vengono sganciati a Tirano e il carburante viene travasato nella motrice.

---

## Regolamento

### Pause (Reg. CE 561/2006)
- Pausa 45 min dopo 4h30 di guida continua
- Le pause vengono fatte durante carico/scarico:
  - A Milano: 45 min durante carico
  - A Livigno: 45 min durante scarico

### Eccezioni ADR
- Max 2 eccezioni per settimana lavorativa
- Permettono di estendere il turno oltre le 9h standard
- L1 usa le eccezioni per ADR LOOP (8.5h guida + 45min pausa)

### Dogana
- Confine Svizzero a Livigno chiude alle **18:30**
- Tutti gli arrivi devono avvenire entro questo orario
