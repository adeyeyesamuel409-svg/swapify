# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN npm ci --ignore-scripts

COPY packages/db packages/db
COPY packages/shared packages/shared
COPY apps/api apps/api

RUN npm run build -w @swapify/db \
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

COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/prisma packages/db/prisma
COPY --from=build /app/packages/shared/dist packages/shared/dist

EXPOSE 4000
USER node
CMD ["node", "apps/api/dist/server.js"]
