# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY tsconfig.json ./
COPY src ./src/

# Build TypeScript
RUN npm run build


# Production stage
FROM node:20-slim AS production

# Install OpenSSL for Prisma + Python3 for CP-SAT solver
RUN apt-get update && apt-get install -y \
    openssl \
    ca-certificates \
    python3 \
    python3-pip \
    && pip3 install --break-system-packages ortools \
    && rm -rf /var/lib/apt/lists/*

# Security: create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 -g nodejs -m nodejs

WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && \
    npm install -g tsx && \
    npx prisma generate && \
    npm cache clean --force

# Copy built application
COPY --from=builder /app/dist ./dist

# Copy Python solver
COPY src/solver ./dist/solver

# Security: change ownership and switch to non-root user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))" || exit 1

# Start application
CMD ["node", "dist/index.js"]
