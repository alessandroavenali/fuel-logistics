# Fuel Logistics - Guida al Deploy

Questa guida descrive come deployare Fuel Logistics in un ambiente Docker isolato.

## Architettura

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Network Isolato                        │
│                    (fuel-logistics-net)                          │
│                                                                  │
│  ┌─────────────────┐    ┌─────────────────┐    ┌──────────────┐ │
│  │    Frontend     │    │     Backend     │    │  PostgreSQL  │ │
│  │ (nginx-unpriv)  │───▶│   (Node.js)     │───▶│    (DB)      │ │
│  │    :8080        │    │     :3001       │    │   :5432      │ │
│  └────────┬────────┘    └─────────────────┘    └──────────────┘ │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
    Porta esposta (default: 8080)
    Configurabile via EXPOSE_PORT
```

## Stack Tecnologico

| Componente | Tecnologia | Immagine Docker |
|------------|------------|-----------------|
| Frontend | React 18 + Vite + Tailwind | `nginxinc/nginx-unprivileged:alpine` |
| Backend | Node.js 20 + Express + Prisma | `node:20-slim` (Debian) |
| Database | PostgreSQL 15 | `postgres:15-alpine` |

## Requisiti

- Docker Engine 20.10+
- Docker Compose v2+
- 2GB RAM disponibile
- 5GB spazio disco

## Misure di Sicurezza Implementate

| Misura | Descrizione |
|--------|-------------|
| **Network isolato** | I container comunicano solo tra loro via `fuel-logistics-net` |
| **Nessuna porta DB** | PostgreSQL non è accessibile dall'esterno |
| **Utenti non-root** | Tutti i container girano con utenti dedicati (UID 1001) |
| **no-new-privileges** | Impedisce l'escalation di privilegi |
| **Read-only filesystem** | Backend ha filesystem in sola lettura |
| **Memory limits** | Limiti di memoria per ogni container |
| **Nomi univoci** | Tutti i nomi sono prefissati con `fuel-logistics-` |

### Cosa NON può fare l'applicazione:

- ❌ Accedere al filesystem dell'host
- ❌ Vedere altri container o servizi sul server
- ❌ Comunicare con la rete host (eccetto API esterne per routing)
- ❌ Acquisire privilegi elevati
- ❌ Modificare il proprio filesystem (backend read-only)

## Installazione Rapida

### 1. Copia i file sul server

```bash
# Dal computer locale
rsync -avz --exclude node_modules --exclude .git --exclude .env \
  /path/to/fuel-logistics/ user@server:~/fuel-logistics/
```

### 2. Configura l'ambiente

```bash
ssh user@server
cd ~/fuel-logistics

# Copia il template
cp .env.production.example .env

# Modifica le variabili
nano .env
```

**Variabili obbligatorie:**

```bash
# Password database (usa solo caratteri alfanumerici!)
POSTGRES_PASSWORD=UnaPasswordSicura123

# Segreto JWT (genera con: openssl rand -base64 32 | tr '+/' '_-')
JWT_SECRET=il_tuo_segreto_jwt_qui

# Porta esposta (cambia se 8080 è già in uso)
EXPOSE_PORT=8080
```

> ⚠️ **IMPORTANTE**: La password del database NON deve contenere caratteri speciali come `/`, `@`, `#` perché causano problemi nel parsing dell'URL di connessione.

### 3. Esegui il deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

### 4. (Opzionale) Popola con dati demo

```bash
./deploy.sh --seed
```

## Deploy Manuale (senza script)

```bash
# 1. Build delle immagini
docker compose build --no-cache

# 2. Avvia i container
docker compose up -d

# 3. Attendi che siano healthy
docker compose ps

# 4. Esegui migrazioni database
docker compose exec -T backend npx prisma db push --accept-data-loss

# 5. (Opzionale) Seed dati
docker compose exec -T -e TSX_DISABLE_CACHE=1 backend tsx prisma/seed.ts
```

## Comandi Utili

```bash
# Stato dei container
docker compose ps

# Log in tempo reale
docker compose logs -f

# Log di un servizio specifico
docker compose logs -f backend

# Riavviare i servizi
docker compose restart

# Fermare i servizi
docker compose down

# Fermare e rimuovere volumi (ATTENZIONE: cancella i dati!)
docker compose down -v

# Entrare in un container (debug)
docker compose exec backend sh
docker compose exec postgres psql -U fuel_user -d fuel_logistics

# Backup database
docker compose exec -T postgres pg_dump -U fuel_user fuel_logistics > backup.sql

# Restore database
cat backup.sql | docker compose exec -T postgres psql -U fuel_user -d fuel_logistics
```

## Aggiornamento

```bash
cd ~/fuel-logistics

# Scarica nuova versione
git pull  # o rsync dai sorgenti

# Rebuild e restart
docker compose down
docker compose build --no-cache
docker compose up -d

# Migrazioni (se necessario)
docker compose exec -T backend npx prisma db push --accept-data-loss
```

## Troubleshooting

### Container non partono

```bash
# Verifica i log
docker compose logs postgres
docker compose logs backend
docker compose logs frontend

# Verifica risorse
docker system df
free -h
```

### Errore "address already in use"

La porta è già occupata da un altro servizio.

```bash
# Trova cosa usa la porta
ss -tlnp | grep :8080

# Cambia la porta in .env
EXPOSE_PORT=8088

# Riavvia
docker compose up -d
```

### Errore Prisma OpenSSL

Se vedi errori come `libssl.so.1.1: No such file or directory`:

1. Verifica che il Dockerfile del backend usi `node:20-slim` (Debian) e non `node:20-alpine`
2. Verifica che `prisma/schema.prisma` abbia il binaryTarget corretto:
   ```prisma
   generator client {
     provider = "prisma-client-js"
     binaryTargets = ["native", "debian-openssl-3.0.x"]
   }
   ```
3. Rebuild: `docker compose build backend --no-cache`

### Database non raggiungibile

```bash
# Verifica che postgres sia healthy
docker compose ps
docker compose exec postgres pg_isready -U fuel_user

# Verifica la stringa di connessione
docker compose exec backend printenv DATABASE_URL
```

### Frontend non raggiunge il backend

```bash
# Verifica la rete
docker network inspect fuel-logistics-net

# Test connessione interna
docker compose exec frontend wget -qO- http://backend:3001/health
```

## Migrazione Database Esistente

Se hai un database esistente da migrare:

```bash
# 1. Esporta dal database locale
pg_dump -U postgres -d fuel_logistics > fuel_logistics_backup.sql

# 2. Copia sul server
scp fuel_logistics_backup.sql user@server:~/

# 3. Importa nel container
cat fuel_logistics_backup.sql | docker compose exec -T postgres psql -U fuel_user -d fuel_logistics
```

## Struttura File

```
fuel-logistics/
├── backend/
│   ├── Dockerfile           # Build Node.js (Debian-based)
│   ├── .dockerignore
│   ├── prisma/
│   │   └── schema.prisma    # Schema DB con binaryTargets
│   └── ...
├── frontend/
│   ├── Dockerfile           # Build con nginx-unprivileged
│   ├── nginx.conf           # Proxy API, SPA routing, headers
│   ├── .dockerignore
│   └── ...
├── docker-compose.yml       # Orchestrazione servizi
├── .env.production.example  # Template variabili ambiente
├── deploy.sh                # Script deploy automatico
└── DEPLOY.md                # Questa documentazione
```

## Risorse Allocate

| Container | RAM Min | RAM Max | Note |
|-----------|---------|---------|------|
| PostgreSQL | 128MB | 512MB | Volume persistente |
| Backend | 128MB | 512MB | Filesystem read-only |
| Frontend | 64MB | 128MB | Serve file statici |
| **Totale** | **320MB** | **1.15GB** | |

## Note Tecniche

### Perché node:20-slim invece di Alpine?

Prisma richiede librerie OpenSSL specifiche. Alpine Linux usa `musl` e OpenSSL 3.x, ma Prisma 5.x ha problemi di compatibilità. Debian-slim (`node:20-slim`) offre migliore compatibilità con le librerie native.

### Perché nginx-unprivileged?

L'immagine `nginxinc/nginx-unprivileged` è già configurata per girare come utente non-root (UID 101), semplificando la configurazione di sicurezza senza dover modificare permessi o configurazioni nginx.

### Filesystem Read-Only

Il backend ha `read_only: true` nel docker-compose. Questo impedisce modifiche al filesystem del container, aumentando la sicurezza. Le directory temporanee necessarie sono montate come `tmpfs`.

---

## Deployment Attuale su flipr-nue

**URL**: http://46.224.126.189:8088

**Data deploy**: 2026-02-03

**Configurazione**:
- Porta: 8088 (8080 era occupata)
- Database: PostgreSQL in volume `fuel-logistics-postgres-data`
- Network: `fuel-logistics-net`

**Credenziali** (in `/root/fuel-logistics/.env`):
- `POSTGRES_PASSWORD`: FuelLogistics2026SecurePass
- `JWT_SECRET`: SAsvxLi6V7yaGm3H12KxuAaR_Mgjt_Qbf_BWPldQSLI

---

*Documentazione aggiornata: 2026-02-03*
