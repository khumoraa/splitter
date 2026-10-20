## Multi-stage Dockerfile for splitter-backend (NodeNext ESM + Prisma), Node 22 LTS

### Stage 1: build
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Prisma needs OpenSSL
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps with caching
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source
COPY . .

# Generate Prisma client (no DB needed for generate)
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Prune dev deps (the prisma CLI stays: it is a runtime dependency used for migrate deploy)
RUN npm prune --omit=dev

### Stage 2: runtime
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy production deps and built artifacts
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package*.json ./

# The app defaults to port 3001 (override with PORT)
EXPOSE 3001

# Apply pending migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
