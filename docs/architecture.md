# Swapify Architecture

## Product summary

Swapify is a barter marketplace. Users list items they no longer want and swap
them for things they need. When the two items have unequal value, the difference
is settled with a one-off **GBP payment** (plus a 5% service fee) charged through
**Stripe**. The swap only completes once both parties confirm receipt, and users
rate each other afterwards.

## Monorepo layout

```
swapify/
├── apps/
│   ├── web/          # Next.js frontend (SEO-friendly listing pages)
│   └── api/          # Fastify API (all business logic)
├── packages/
│   ├── db/           # Prisma schema, migrations, generated client, seed
│   └── shared/       # Shared constants & utilities (money math in GBP pence)
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
                                │ Lambda workers   │  image resize, email, payment settlement timeouts
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
| SQS + Lambda         | Background jobs: thumbnails, notifications, payment settlement timeouts |
| Cognito              | Managed auth (email + Google), scales to millions |
| OpenSearch (Sprint 9)| Full-text listing search + wishlist matching |
| CloudWatch / Secrets | Monitoring, alerts, secure secret storage |

## Key design decisions

### 1. GBP value-gap payments (the heart of the product)
- Every money amount is stored as an integer number of **pence** (1 = £0.01) to
  avoid floating-point money bugs. The UI converts pence to pounds for display
  only.
- When a swap is agreed with unequal values, the API creates a single `Payment`
  record for that swap (`amountPence` = the value gap, `feePence` = 5% service
  fee, `totalPence` = their sum).
- The gap payer is sent to Stripe Checkout, where both line items use GBP minor
  units (pence). Stripe confirms the charge with a signed `checkout.session.completed`
  webhook, and `markPaymentPaid` advances the swap to `PAID`.
- Idempotency: each swap has exactly one `Payment` (unique `swapId`), each
  checkout has a unique Stripe session id, and an already-`PAID` payment is never
  re-credited — a retried webhook (Stripe redelivery) or repeated pay click can
  never double-charge.
- Production is fail-closed: with `NODE_ENV=production`, a missing Stripe key
  refuses checkout (503) and the payment is never simulated.

### 2. Swap state machine
```
REQUESTED -> AGREED -> PAID -> COMPLETED
    |           |         |
    v           v         v
CANCELLED / EXPIRED
```
- On AGREED, both parties accepted; the value-gap payer can start the Stripe
  checkout.
- PAID means the required GBP payment/difference has been successfully confirmed
  by Stripe. It is not escrow — no funds are held; it simply records that the
  gap payment was received.
- COMPLETED requires both parties to confirm receipt; ownership of both items
  transfers and their status becomes `SWAPPED`.
- CANCELLED / EXPIRED (past the deadline, swept by the sweeper) frees the items;
  any recorded payment is refunded via Stripe (a no-op in the simulated flow).

### 3. Valuation is pluggable
- Items carry a user-set `valuePence` today.
- A `ValuationService` interface will be introduced later so an AI model
  (photos + description -> price) can slot in without touching the schema.

### 4. Scaling to 1M users
- Stateless API -> horizontal scale behind the load balancer.
- Redis absorbs hot reads (profiles, listings); OpenSearch offloads search.
- Partition `Payment` and `Message` by time in Sprint 9.
- CDN + S3 for all images; background workers for any CPU-heavy work.

## Development flow
- Local: `infra/docker-compose.yml` runs Postgres 16 + Redis 7.
- Sprint 8 replaces them with RDS and ElastiCache; code stays the same because
  it connects via `DATABASE_URL` / `REDIS_URL` env vars.
