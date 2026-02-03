#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Fuel Logistics - Deploy Script ===${NC}"

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo -e "${YELLOW}Copy .env.production.example to .env and configure it:${NC}"
    echo "  cp .env.production.example .env"
    echo "  nano .env"
    exit 1
fi

# Check required variables
source .env
if [ -z "$POSTGRES_PASSWORD" ] || [ "$POSTGRES_PASSWORD" = "CHANGE_ME_SECURE_PASSWORD_HERE" ]; then
    echo -e "${RED}Error: POSTGRES_PASSWORD not configured in .env${NC}"
    exit 1
fi

if [ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "CHANGE_ME_GENERATE_SECURE_SECRET" ]; then
    echo -e "${RED}Error: JWT_SECRET not configured in .env${NC}"
    echo -e "${YELLOW}Generate one with: openssl rand -base64 32${NC}"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed${NC}"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}[1/4] Building Docker images...${NC}"
docker compose build --no-cache

echo -e "${GREEN}[2/4] Stopping existing containers (if any)...${NC}"
docker compose down 2>/dev/null || true

echo -e "${GREEN}[3/4] Starting services...${NC}"
docker compose up -d

echo -e "${GREEN}[4/4] Waiting for services to be healthy...${NC}"
sleep 5

# Wait for backend to be healthy
echo -n "Waiting for backend"
for i in {1..30}; do
    if docker compose exec -T backend node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" 2>/dev/null; then
        echo -e " ${GREEN}OK${NC}"
        break
    fi
    echo -n "."
    sleep 2
done

# Run database migrations
echo -e "${GREEN}Running database migrations...${NC}"
docker compose exec -T backend npx prisma migrate deploy 2>/dev/null || \
docker compose exec -T backend npx prisma db push --accept-data-loss

# Ask about seeding
if [ "$1" = "--seed" ]; then
    echo -e "${GREEN}Seeding database with initial data...${NC}"
    docker compose exec -T -e TSX_DISABLE_CACHE=1 backend tsx prisma/seed.ts
fi

echo ""
echo -e "${GREEN}=== Deployment Complete ===${NC}"
echo -e "Application is running at: ${YELLOW}http://localhost:${EXPOSE_PORT:-8080}${NC}"
echo ""
echo "To seed the database with initial data, run:"
echo "  ./deploy.sh --seed"
echo ""
echo "Useful commands:"
echo "  docker compose logs -f        # View logs"
echo "  docker compose ps             # Check status"
echo "  docker compose down           # Stop services"
echo "  docker compose restart        # Restart services"
