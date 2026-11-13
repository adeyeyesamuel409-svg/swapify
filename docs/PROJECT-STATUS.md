# Swapify — Project Status

Last updated: 2026-11-05

## What's built

### Platform & infrastructure
- **Migrated from AWS → DigitalOcean** (London): App Platform (Docker, web + API), Managed PostgreSQL 16, Spaces (images/CDN). Cost ~**$35/mo vs ~£250–347/mo**. AWS fully decommissioned; Route 53 kept for DNS.
- **Modular monolith**: TypeScript monorepo — `apps/web` (Next.js 16, React 19, Tailwind v4, framer-motion), `apps/api` (Fastify + Prisma), `packages/db`, `packages/shared`.
- **Push-to-deploy** from GitHub; multi-stage Docker builds; `check:encoding` + typecheck/lint build gates.

### Auth & security
- Email/password auth replacing AWS Cognito: scrypt hashing, HMAC JWTs, NextAuth sessions.
- **Email verification + password reset** (6-digit hashed codes, expiring, single-use) via Resend — login blocked until verified.
- Stripe **LIVE/TEST mode gate** (fail-closed webhooks), DB firewall locked to app VPC + admin IP.
- Fixed en route: scrypt salt bug (login 100% failure), RSC crash on profile, image upload (SSE/ACL), mojibake corruption, misleading sign-in errors.

### Marketplace
- **Listings**: post flow (drag-drop upload, thumbnail re-ordering, condition chips, value helper, live preview), browse/search/filter/pagination, item detail (gallery, seller card, wishlist matches, similar listings), delete from item page.
- **Pre-swap chat**: "Ask a question" threads (per item/buyer), `/messages` inbox, notifications.
- **Swap lifecycle**: SwapBuilder proposal, accept/decline/cancel, trade chat, escrow value-gap payments (pending → available on completion), receipt confirmation, ratings, shipping flows.

### Payments (unified "Payments" hub)
- **Balance** (pending/available + ledger), **Pay with** (saved cards via Stripe — hosted card form, saved cards at checkout), **Where you get paid** (Stripe Connect Express onboarding + withdrawals + history).
- Refunds return to the original card, bypassing the balance. Status-mapping bug fixed (resolvable ≠ "Unavailable").

### UI/UX
- Full redesign: navy/maroon light-first theme + **dark mode**, brand mark (pink/navy "S"), favicon set, hero with word-reveal + swap-landing accent + **3s photo carousel** (5 photos), 8-section marketplace rhythm, trust microcopy ("Secure & Encrypted Sign-In"), "Verified Swapper" badges + star ratings, 44px touch targets, sticky mobile action bars, keyboard-safe chat, zero-em-dash punchy copy.

## What's left

### Needs your action
1. **Rotate the Resend API key** (it leaked in a transcript) → update `RESEND_API_KEY` in the DO env.
2. **Delete `Downloads\Do.txt`** (DO API token) when done with ops changes.
3. If sign-in still fails for you: **"Forgot password?"** recovery path.

### Before public launch (gates — from the readiness work)
- **G1 UK legal/regulatory review** (decisive — LIVE activation is NO-GO until it clears), G2/G4/G7 production telemetry & alert evidence, G3 Stripe LIVE config review, G5 live refund/dispute behaviour, G6 tabletop exercise.

### Mock → real wiring (design honesty)
- **Proximity distances, trust scores, "Verified Swapper" badges** are deterministic mocks (`lib/mock.ts`) — wire to real API fields before launch (badges must not out-run facts).

### Feature gaps (candidate backlog)
- **Listing edit** (copy says "edit everything later" — no edit flow exists yet; delete only)
- Email notifications (currently in-app bell only) via Resend
- Inquiry-thread → swap chat history merge (currently separate)
- Report/block users (safety hooks)
- Chat niceties: read receipts, typing indicators
- Item photos: reorder is per-thumbnail only (no crop/rotate)

### Ops & maintenance
- **DB firewall admin IP** rotates with the home IP — update when admin DB access breaks (or switch to a stable egress).
- **Autodeploy webhook occasionally lags** — manual "Force Rebuild" (or API deploy) as fallback.
- **node_modules corruption** has recurred 3× (missing workspace links / broken packages) — fix is a targeted reinstall; consider `npm ci` in CI to catch it.
- **docs/production-runbook.md is AWS-era** — needs a DO rewrite (deploy, rollback, DB, DNS, secrets).
- No CI pipeline yet — suggest GitHub Actions running `check:encoding` + typecheck + lint + build + E2E on every push.
