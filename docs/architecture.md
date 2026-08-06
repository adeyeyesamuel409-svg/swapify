# Swapify Architecture

## Product summary

Swapify is a barter marketplace. Users list items they no longer want and swap
them for things they need. When the two items have unequal value, the difference
is paid with **tokens**. Tokens are bought with real money (Stripe) or earned by
completing swaps. All swaps are protected by **escrow** until both parties
confirm receipt, and users rate each other afterwards.

## Monorepo layout

```
swapify/
├── apps/
│   ├── web/          # Next.js frontend (SEO-friendly listing pages)
│   └── api/          # Fastify API (all business logic)
├── packages/
│   ├── db/           # Prisma schema, migrations, generated client, seed
│   └── shared/       # Shared constants & utilities (token math)
├── infra/            # Docker Compose, later: Terraform / ECS configs
└── docs/             # This doc, backlog, agile process
```

## Target architecture (AWS, end state)

```
                        ┌─────────────────────────┐
                        │     Route 53 (DNS)      │
                        └─────────────────────────┘
                                   │
                 ┌─────────────────┼─────────────────┐
                 │                                   │
         ┌───────▼────────┐                  ┌───────▼────────┐
         │ CloudFront CDN │──static files──▶│ S3 (frontend + │
         │     + WAF      │                  │    item photos)│
         └───────┬────────┘                  └────────────────┘
                 │ /api/*
         ┌───────▼────────┐      ┌───────────────┐      ┌───────────────┐
         │  Load Balancer  │      │ RDS PostgreSQL│      │ ElastiCache   │
         └───────┬────────┘      │ (primary data)│      │ Redis (cache, │
                 │               └───────────────┘      │ queue, pubsub)│
         ┌───────▼────────┐                             └───────┬───────┘
         │ ECS Fargate    │      ┌───────────────┐             │
         │ API containers │─────▶│ SQS (jobs)    │◀────────────┘
         └────────────────┘      └───────┬───────┘
                                         ▼
                               ┌──────────────────┐
                               │ Lambda workers   │  image resize, email, escrow timeouts
                               └──────────────────┘
```

| Service              | Role |
|----------------------|------|
| Route 53             | Domain + DNS |
| CloudFront + WAF     | Global CDN, static hosting, security |
| S3                   | Frontend build + item photos |
| ALB + ECS Fargate    | Runs the Fastify API, auto-scales, no servers to manage |
| RDS PostgreSQL       | Primary data store |
| ElastiCache Redis    | Caching + BullMQ job queue + pub/sub for chat |
| SQS + Lambda         | Background jobs: thumbnails, notifications, escrow timeouts |
| Cognito              | Managed auth (email + Google), scales to millions |
| OpenSearch (Sprint 9)| Full-text listing search + wishlist matching |
| CloudWatch / Secrets | Monitoring, alerts, secure secret storage |

## Key design decisions

### 1. Token ledger (the heart of the product)
- Every token amount is stored as an integer **micro-token** (1 token = 1,000,000
  micro-tokens) to avoid floating-point money bugs.
- `TokenTransaction` is an **append-only ledger**. Rows are never updated or
  deleted. `Wallet.balanceMicroTokens` is a cached sum for fast reads.
- Every operation has an `idempotencyKey` so a retried request (network blip,
  Stripe webhook redelivery) can never double-credit.
- Balance updates use optimistic locking (`Wallet.version`) and run inside
  Postgres transactions, so concurrent swaps cannot lose tokens.

### 2. Swap state machine
```
REQUESTED -> AGREED -> ESCROWED -> SHIPPED -> COMPLETED
              |            |           |
              v            v           v
          DECLINED      CANCELLED    CANCELLED / EXPIRED
```
- On AGREED, the value gap is moved into an `EscrowHold`.
- Escrow releases to the correct party on COMPLETED, or refunds on cancel/expiry.

### 3. Valuation is pluggable
- Items carry a user-set `valueMicroTokens` today.
- A `ValuationService` interface will be introduced later so an AI model
  (photos + description -> price) can slot in without touching the schema.

### 4. Scaling to 1M users
- Stateless API -> horizontal scale behind the load balancer.
- Redis absorbs hot reads (profiles, listings); OpenSearch offloads search.
- Partition `TokenTransaction` and `Message` by time in Sprint 9.
- CDN + S3 for all images; background workers for any CPU-heavy work.

## Development flow
- Local: `infra/docker-compose.yml` runs Postgres 16 + Redis 7.
- Sprint 8 replaces them with RDS and ElastiCache; code stays the same because
  it connects via `DATABASE_URL` / `REDIS_URL` env vars.
