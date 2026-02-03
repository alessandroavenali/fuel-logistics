# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build argument for API URL
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

# Build application
RUN npm run build

# Production stage with nginx-unprivileged (already configured for non-root)
FROM nginxinc/nginx-unprivileged:alpine AS production

# Remove default nginx config
USER root
RUN rm /etc/nginx/conf.d/default.conf
USER nginx

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built application
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port (nginx-unprivileged uses 8080 by default)
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# Start nginx (already configured in base image)
CMD ["nginx", "-g", "daemon off;"]
