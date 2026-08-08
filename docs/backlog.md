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
- [x] Create a listing: photos, title, description, category, condition, value
- [x] Browse listings (grid) and detail page
- [x] Search & filter by category / condition (basic)
- [x] Mark item active / hidden
- [ ] Upload photos to S3 via presigned URL (basic pipeline)

## Sprint 3 - Wallet & ledger
- [x] View wallet balance and transaction history (GET /wallet + /wallet page)
- [x] Earn tokens (10-token welcome bonus on first signup, idempotent)
- [x] Immutable append-only ledger with idempotency keys
- [x] Concurrency-safe balance updates (atomic ops + SERIALIZABLE tx + retry)
- [ ] Referral rewards (moved to future)

## Sprint 4 - Swap engine
- [x] Request a swap: offer one of my items for a listing
- [x] Value-difference calculation (offered vs requested)
- [x] Determine gap payer and required token amount
- [x] Accept / decline a swap request
- [x] Swap state machine (REQUESTED -> AGREED -> CANCELLED); items reserved while active
- [ ] Gap tokens actually move when agreed (escrow - Sprint 5)

## Sprint 5 - Escrow
- [x] Hold gap tokens in escrow when swap is agreed (payer funds; ledger debited)
- [x] Confirm receipt flow for both parties (completes when both confirm)
- [x] Release escrow on completion; refund on cancel
- [x] Escrow timeout / expiry handling (auto-sweep + manual expire)
- [x] Ownership transfers to the new owner on completion

## Sprint 6 - Buy tokens (Stripe)
- [x] Token price tiers (Stripe Checkout)
- [x] Stripe webhook -> credit wallet (idempotent)
- [x] Order history in the UI
- [ ] Real Stripe live keys + webhook endpoint (dev simulation works without keys)

## Sprint 7 - Marketplace
- [x] Chat on a swap (replaces external messaging)
- [x] Ratings & reviews after completed swap
- [x] Wishlists: list items I need; match against listings
- [x] Notifications (in-app; email deferred)
- [x] Admin dashboard: users, listings, disputes (users + listings + token credit; disputes deferred)
- [ ] Email notifications (SES)

## Sprint 8 - UI/UX refinement & design system
- [x] Design tokens + dark premium theme (palette, typography, spacing, radius, shadows) in globals.css
- [x] Shared UI primitives: Button, ItemCard, StatusPill, SectionHeader, PlaceholderImage
- [x] Global sticky header: logo, nav, search, token balance, notification bell, avatar menu, mobile menu
- [x] Global footer with marketplace / account / tokens link columns
- [x] New homepage: hero with real featured photos, featured listings, how it works, categories, tokens explainer, final CTA
- [x] Restyle inner pages (browse, item detail, post, wallet, swaps, tokens, wishlists, notifications, profile, admin) to the new system
- [x] Fix homepage horizontal overflow; responsive at mobile / tablet / laptop / desktop / ultrawide

## Sprint 9 - Deploy to AWS
- [ ] Dockerfiles for API and web
- [ ] ECS Fargate services + Application Load Balancer
- [ ] Migrate Postgres Docker -> RDS; Redis Docker -> ElastiCache
- [ ] S3 + CloudFront for images and static frontend
- [ ] Route 53 custom domain + HTTPS
- [ ] CloudWatch logging and alerts

## Sprint 10 - Scale & AI
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
