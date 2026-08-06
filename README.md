# Swapify

A barter marketplace where people swap items they no longer use for things they need. When items have unequal value, Swapify balances the difference with **tokens** that users buy or earn.

## Monorepo layout

```
swapify/
├── apps/
│   ├── web/          # Next.js frontend
│   └── api/          # Fastify API service
├── packages/
│   ├── db/           # Prisma schema + generated client
│   └── shared/       # Shared TypeScript types & utilities
├── infra/            # Docker Compose, deploy configs
└── docs/             # Backlog, architecture, agile process
```

## Getting started

```bash
# 1. Install dependencies (from repo root)
npm install

# 2. Start local Postgres + Redis
npm run docker:up

# 3. Set up your local env (copy and fill in values)
copy .env.example .env

# 4. Generate the Prisma client and run migrations
npm run db:generate
npm run db:migrate

# 5. Run the API (http://localhost:4000/health) and the web app (http://localhost:3000)
npm run dev
```

## Development process

We work in 1-week Agile sprints. See `docs/agile.md` for the process and `docs/backlog.md` for the product backlog.
