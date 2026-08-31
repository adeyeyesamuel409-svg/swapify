# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN npm ci --ignore-scripts

# node:20-slim ships no OpenSSL, so Prisma cannot detect the engine variant
# and falls back to an unpredictable default. Install OpenSSL so Prisma
# generates the engine that matches this Debian (Bookworm / OpenSSL 3.0)
# image at runtime.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY packages/db packages/db
COPY packages/shared packages/shared
COPY apps/api apps/api

# Generate the Prisma client (postinstall is skipped above via --ignore-scripts,
# so generate explicitly). This runs against the Debian build image and produces
# the correct libquery_engine for Linux, not the host's Windows engine.
RUN npm run db:generate -w @swapify/db \
 && npm run build -w @swapify/db \
 && npm run build -w @swapify/shared \
 && npm run build -w @swapify/api

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --ignore-scripts

# Install OpenSSL in the runtime image so Prisma can detect the engine variant
# (OpenSSL 3.0 on Debian Bookworm) and load the matching libquery_engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/prisma packages/db/prisma
COPY --from=build /app/packages/shared/dist packages/shared/dist

# Copy the generated Prisma client (client JS + Linux query engine) into the
# runtime image. The runtime npm ci uses --omit=dev --ignore-scripts, so it
# installs @prisma/client but not the generated client; we stage it here from
# the build stage rather than generating at runtime.
COPY --from=build /app/node_modules/.prisma/client node_modules/.prisma/client

EXPOSE 4000
USER node
CMD ["node", "apps/api/dist/server.js"]
