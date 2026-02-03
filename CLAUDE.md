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
| Vehicles | 4 | Motrici con cisterna integrata 17.500L. FG001AA base Livigno, altri base Tirano |
| Trailers | 4 | Rimorchi 17.500L, tutti base Tirano |
| Drivers | 5 | 1 Livigno (Marco Bianchi), 4 Tirano |
| Routes | 4 | Tirano→Livigno: 120min (salita), Livigno→Tirano: 90min (discesa), Milano↔Tirano: 150min |

### Modello Logistico

- **Motrici**: hanno cisterna integrata da 17.500L (non staccabile)
- **Rimorchi**: cisterne aggiuntive da 17.500L trainabili dalle motrici
- **Capacità totale per viaggio**: motrice (17.500L) + rimorchio (17.500L) = 35.000L

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

### TypeScript

- Backend: compila con `tsc`, test esclusi dalla build produzione
- Frontend: Vite + React + TypeScript

### Docker

- Backend: `node:20-slim` con user non-root, filesystem read-only
- Frontend: `nginx-unprivileged:alpine`
- Database: `postgres:15-alpine`, porta NON esposta all'host
- Network isolata: `fuel-logistics-net`

## Cronologia Recente

- **2026-02-03**: Aggiunto CI/CD GitHub Actions, allineato seed con DB locale
- **2026-02-03**: Deploy Docker su flipr-nue con security isolation
- **2026-02-01**: Feature stato iniziale eccezioni ADR
