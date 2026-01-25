#!/bin/bash

# Fuel Logistics - Script di avvio
# Uso: ./start.sh [--kill-only]

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_PORT=3002
FRONTEND_PORT=5174

echo -e "${YELLOW}=== Fuel Logistics ===${NC}"

# Funzione per killare processi su una porta
kill_port() {
    local port=$1
    local pids=$(lsof -ti:$port 2>/dev/null)
    if [ -n "$pids" ]; then
        echo -e "${RED}Termino processi su porta $port...${NC}"
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Funzione per aspettare che un servizio sia pronto
wait_for_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=1

    echo -n "Attendo $name"
    while [ $attempt -le $max_attempts ]; do
        if curl -s "$url" > /dev/null 2>&1; then
            echo -e " ${GREEN}OK${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
        ((attempt++))
    done
    echo -e " ${RED}TIMEOUT${NC}"
    return 1
}

# Kill processi esistenti
echo -e "\n${YELLOW}[1/4] Termino processi esistenti...${NC}"
kill_port $BACKEND_PORT
kill_port $FRONTEND_PORT

# Opzione --kill-only
if [ "$1" == "--kill-only" ]; then
    echo -e "${GREEN}Processi terminati.${NC}"
    exit 0
fi

# Verifica PostgreSQL locale
echo -e "\n${YELLOW}[2/4] Verifico PostgreSQL...${NC}"
if pg_isready -q 2>/dev/null; then
    echo -e "PostgreSQL ${GREEN}OK${NC}"
else
    echo -e "${RED}PostgreSQL non attivo. Avvialo con:${NC}"
    echo "  brew services start postgresql@17"
    exit 1
fi

# Avvia backend
echo -e "\n${YELLOW}[3/4] Avvio backend (porta $BACKEND_PORT)...${NC}"
cd "$PROJECT_DIR/backend"
npm run dev > "$PROJECT_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

wait_for_service "http://localhost:$BACKEND_PORT/api/vehicles" "Backend"

# Avvia frontend
echo -e "\n${YELLOW}[4/4] Avvio frontend (porta $FRONTEND_PORT)...${NC}"
cd "$PROJECT_DIR/frontend"
npm run dev > "$PROJECT_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

wait_for_service "http://localhost:$FRONTEND_PORT" "Frontend"

# Riepilogo
echo -e "\n${GREEN}=== Tutto avviato! ===${NC}"
echo -e "Database:  ${GREEN}postgresql://localhost:5432/fuel_logistics${NC}"
echo -e "Backend:   ${GREEN}http://localhost:$BACKEND_PORT${NC} (PID: $BACKEND_PID)"
echo -e "Frontend:  ${GREEN}http://localhost:$FRONTEND_PORT${NC} (PID: $FRONTEND_PID)"
echo -e "\nLog: backend.log, frontend.log"
echo -e "Per terminare: ${YELLOW}./start.sh --kill-only${NC}"
