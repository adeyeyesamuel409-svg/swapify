# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN npm ci --ignore-scripts

COPY packages/shared packages/shared
RUN npm run build -w @swapify/shared

COPY apps/web apps/web

# Build-time configuration for the Next.js client bundles. Next inlines
# NEXT_PUBLIC_* values at build time, so these must be present in the build
# stage or client bundles fall back to localhost URLs. Values are supplied
# via --build-arg; nothing is hard-coded here.
ARG NEXT_PUBLIC_IMAGE_BASE_URL
ARG API_URL
ENV NEXT_PUBLIC_IMAGE_BASE_URL=$NEXT_PUBLIC_IMAGE_BASE_URL
ENV API_URL=$API_URL

RUN npm run build -w @swapify/web

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Next.js standalone output: self-contained server + minimal node_modules.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static apps/web/.next/static
COPY --from=build /app/apps/web/public apps/web/public

EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
