# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:20-slim AS builder


# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy manifests first for layer caching
COPY package.json pnpm-lock.yaml ./

# Install all deps (including devDeps needed for build)
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Compile TypeScript → dist/
RUN pnpm run build

# ─── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:20-slim AS runner


# Install pnpm (needed for prod install)
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

# Copy manifests
COPY package.json pnpm-lock.yaml ./

# Install production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Copy static assets served by Express
COPY --from=builder /app/public ./public

# Copy views (HTML templates rendered server-side)
COPY --from=builder /app/src/views ./src/views

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 4000

# Use compiled JS — no tsx/ts-node in production
CMD ["node", "dist/server.js"]
