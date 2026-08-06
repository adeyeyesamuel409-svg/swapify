# Swapify Product Backlog

Backlog is ordered by priority. Each sprint picks the top 3-5 items.
Legend: [ ] not started · [x] done · [-] in progress

## Sprint 0 - Foundations
- [x] Create monorepo (npm workspaces), git repo, README
- [x] Scaffold Next.js web app (`apps/web`)
- [x] Scaffold Fastify API (`apps/api`) with health endpoint
- [x] Prisma schema for all core entities (`packages/db`)
- [x] Docker Compose for local Postgres + Redis
- [x] Docs: this backlog, architecture, agile process
- [x] CI skeleton (lint + typecheck) and env setup

## Sprint 1 - Authentication (AWS Cognito)
- [x] Provision Cognito user pool + app client (CloudFormation: infra/cloudformation/cognito.yml)
- [x] Configure AWS credentials and Secrets Manager (secret: swapify/cognito)
- [x] Wire Cognito JWT verification into the API (jose + JWKS, client_id check)
- [x] Sign up / log in with email + password (Cognito Hosted UI). Google deferred to Sprint 7
- [x] Link Cognito subject to local User record; create Wallet on signup (auto on first login)
- [x] User profile page (view: name, email, token balance). Edit (name/bio/photo) moved to future
- [x] Session handling on the web app (Auth.js + NextAuth, protected /profile)

## Sprint 2 - Listings
- [ ] Create a listing: photos, title, description, category, condition, value
- [ ] Browse listings (grid) and detail page
- [ ] Search & filter by category / condition (basic)
- [ ] Mark item active / hidden
- [ ] Upload photos to S3 via presigned URL (basic pipeline)

## Sprint 3 - Wallet & ledger
- [x] View wallet balance and transaction history (GET /wallet + /wallet page)
- [x] Earn tokens (10-token welcome bonus on first signup, idempotent)
- [x] Immutable append-only ledger with idempotency keys
- [x] Concurrency-safe balance updates (atomic ops + SERIALIZABLE tx + retry)
- [ ] Referral rewards (moved to future)

## Sprint 4 - Swap engine
- [ ] Request a swap: offer one of my items for a listing
- [ ] Value-difference calculation (offered vs requested)
- [ ] Determine gap payer and required token amount
- [ ] Accept / decline a swap request
- [ ] Swap state machine (REQUESTED -> AGREED -> ...)

## Sprint 5 - Escrow
- [ ] Hold gap tokens in escrow when swap is agreed
- [ ] Confirm receipt flow for both parties
- [ ] Release escrow on completion; refund on cancel
- [ ] Escrow timeout / expiry handling

## Sprint 6 - Buy tokens (Stripe)
- [ ] Token price tiers (Stripe Checkout)
- [ ] Stripe webhook -> credit wallet (idempotent)
- [ ] Order history in the UI

## Sprint 7 - Marketplace
- [ ] Chat on a swap (replaces external messaging)
- [ ] Ratings & reviews after completed swap
- [ ] Wishlists: list items I need; match against listings
- [ ] Notifications (email + in-app)
- [ ] Admin dashboard: users, listings, disputes

## Sprint 8 - Deploy to AWS
- [ ] Dockerfiles for API and web
- [ ] ECS Fargate services + Application Load Balancer
- [ ] Migrate Postgres Docker -> RDS; Redis Docker -> ElastiCache
- [ ] S3 + CloudFront for images and static frontend
- [ ] Route 53 custom domain + HTTPS
- [ ] CloudWatch logging and alerts

## Sprint 9 - Scale & AI
- [ ] Auto-scaling policies and load testing (k6)
- [ ] Image resize pipeline (S3 + Lambda)
- [ ] AI valuation interface (pluggable ValuationService)
- [ ] Search upgrade to OpenSearch; listing partitioning
- [ ] Feature flags and progressive rollout

## Future ideas (not yet scheduled)
- Referral rewards (track referrer + credit tokens)
- Edit profile (name, bio, photo upload)
- Google / social login (enable OAuth IdP in the user pool)
- Shipping labels / carrier integration
- Dispute resolution workflow
- Mobile app (React Native)
- Referral program details
- Gamification (swapper level, badges)
