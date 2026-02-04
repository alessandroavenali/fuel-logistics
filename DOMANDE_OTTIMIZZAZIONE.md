# Domande per Ottimizzazione Logistica Fuel Logistics

**Data**: 26 Gennaio 2026
**Obiettivo**: Chiarire vincoli operativi per implementare ottimizzazione avanzata

---

## Contesto Tecnico

### Situazione Attuale
- **Tratta**: Milano → Tirano → Livigno (e ritorno)
- **Tempi guida**:
  - Livigno ↔ Tirano: 2h (montagna, max 1 rimorchio)
  - Tirano ↔ Milano: 3h (pianura, max 2 rimorchi)
  - **Totale A/R: 10h**

### Problema Identificato
Un viaggio completo A/R richiede **10h di guida**, che:
- Supera il limite ADR standard (9h/giorno)
- Richiede sempre una "giornata estesa" (max 2/settimana per driver)
- Limita ogni driver a **max 2 viaggi completi/settimana**

### Opportunità
Dividendo il viaggio in tratte, si può aumentare l'efficienza del 40-50%:
- **Shuttle Livigno↔Tirano**: 4h A/R, porta 1 rimorchio pieno → 17.500L
- **Rifornimento Tirano↔Milano**: 6h A/R, porta 2 rimorchi pieni a Tirano → 35.000L

---

## DOMANDE OPERATIVE

### 1. ALLOGGIO DRIVER

**1.1** I driver dormono tutti a Livigno?
- [ ] Sì, tutti a Livigno
- [ ] No, alcuni possono dormire a Tirano
- [ ] Dipende (specificare)

**1.2** È possibile/accettabile far dormire un driver a Tirano per più giorni?
- [ ] Sì, abbiamo convenzioni con hotel/B&B
- [ ] Sì, ma costa extra (quanto? ______€/notte)
- [ ] No, non è fattibile

**1.3** I driver "a chiamata" (ON_CALL) e "emergenza" dove sono basati?
- [ ] Livigno
- [ ] Tirano
- [ ] Altra località: ____________

---

### 2. PARCHEGGIO MOTRICI

**2.1** Le motrici possono pernottare a Tirano?
- [ ] Sì, abbiamo un'area dedicata
- [ ] Sì, ma in parcheggio pubblico (rischi?)
- [ ] No, devono tornare a Livigno ogni sera

**2.2** Se sì, c'è un costo per il parcheggio notturno a Tirano?
- [ ] No, gratuito
- [ ] Sì: ______€/notte

**2.3** Quante motrici possono restare a Tirano contemporaneamente?
- [ ] Tutte (4)
- [ ] Massimo: ______ motrici

---

### 3. DEPOSITO RIMORCHI A TIRANO

**3.1** Confermi che le rimorchi PIENI possono restare a Tirano in sicurezza?
- [ ] Sì, area recintata/sorvegliata
- [ ] Sì, ma con limitazioni (quali? _____________)
- [ ] No, problemi di sicurezza

**3.2** C'è un limite al numero di rimorchi che possono stare a Tirano?
- [ ] No, possono stare tutte e 8
- [ ] Massimo: ______ cisterne

**3.3** I rimorchi a Tirano richiedono controlli/manutenzione particolare?
- [ ] No
- [ ] Sì (specificare: _____________)

---

### 4. ORGANIZZAZIONE TRATTE

**4.1** È accettabile che un driver faccia SOLO la tratta Tirano↔Milano?
(Partirebbe da Tirano la mattina, farebbe A/R Milano, finirebbe a Tirano)
- [ ] Sì
- [ ] No, tutti devono poter fare il giro completo
- [ ] Solo alcuni driver (quali? _____________)

**4.2** È accettabile la "staffetta" a Tirano?
(Driver A arriva da Milano, Driver B prende la motrice e va a Livigno)
- [ ] Sì
- [ ] No
- [ ] Solo in casi particolari

**4.3** I driver hanno preferenze/specializzazioni sulle tratte?
- [ ] No, tutti fanno tutto
- [ ] Sì (specificare: _____________)

---

### 5. VINCOLI TEMPORALI

**5.1** Ci sono orari limite per il transito Tirano↔Livigno (strada montagna)?
- [ ] No, sempre aperta
- [ ] Sì, chiusa dalle ______ alle ______
- [ ] Dipende dalla stagione/meteo

**5.2** Ci sono orari limite per carico/scarico a Milano?
- [ ] No, h24
- [ ] Sì, solo dalle ______ alle ______

**5.3** Ci sono orari limite per scarico a Livigno?
- [ ] No
- [ ] Sì, solo dalle ______ alle ______

---

### 6. COSTI E PRIORITÀ

**6.1** Qual è la priorità principale?
- [ ] Massimizzare litri consegnati (anche se costa di più)
- [ ] Minimizzare costi (anche se consegna meno)
- [ ] Bilanciare entrambi

**6.2** Costo indicativo di una notte driver a Tirano: ______€

**6.3** Costo indicativo parcheggio motrice a Tirano: ______€/notte

**6.4** C'è un premio/bonus per consegne extra?
- [ ] No
- [ ] Sì: ______€ per ______L extra

---

### 7. RISORSE FUTURE

**7.1** È previsto di assumere driver basati a Tirano?
- [ ] No
- [ ] Possibile in futuro
- [ ] Sì, stiamo valutando

**7.2** È previsto di aumentare le motrici?
- [ ] No
- [ ] Sì, quando? ____________

**7.3** È previsto di aumentare i rimorchi?
- [ ] No
- [ ] Sì, quante? ______

---

## SCENARI DA VALUTARE

### Scenario A: Status Quo (Viaggi Completi)
- Ogni viaggio = 10h (giornata estesa obbligatoria)
- Max 2 viaggi/settimana per driver
- **Capacità**: ~10 viaggi/settimana = 175.000L

### Scenario B: Mini-Hub Tirano
- Driver "pianura": fa Tirano↔Milano (6h, giornata standard)
- Driver "montagna": fa Livigno↔Tirano shuttle (4h×2 = 8h)
- Richiede: almeno 1 driver che dorme/parte da Tirano
- **Capacità stimata**: +40-50% = ~250.000L/settimana

### Scenario C: Staffetta
- Driver A: Livigno→Milano→Tirano (9h)
- Driver B: Tirano→Livigno (2h)
- Richiede: coordinamento preciso, driver B a Tirano
- **Capacità**: simile a Scenario A ma senza giornate estese

---

## NOTE AGGIUNTIVE

Spazio per appunti dalla discussione:

_______________________________________________

_______________________________________________

_______________________________________________

_______________________________________________

_______________________________________________

---

## PROSSIMI PASSI

Dopo aver raccolto le risposte:
1. Aggiornare l'optimizer con i nuovi vincoli
2. Implementare la funzione "Massimizza Carico"
3. Aggiungere supporto per tratte parziali (se approvato)
4. Testare con scenari reali

---

*Documento generato per discussione interna - Fuel Logistics App*
