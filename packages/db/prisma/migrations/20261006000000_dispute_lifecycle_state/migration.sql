-- R2: charge dispute lifecycle state (P2 BLOCKER 4)
--
-- The previous charge.dispute.created handler wrote
--   Payment.refundedAt = now(), Payment.stripeRefundId = <dispute id>
-- without ever creating a Stripe Refund object. That fabricated refund state,
-- suppressed refundSwapPayment()/reconcileRefunds()/missing-ValueGap repair,
-- and stored a dispute id (dp_...) in a field that may only hold a refund id
-- (re_...).
--
-- This migration adds the minimum state needed to record a dispute durably and
-- to track the transfer reversal attempted when funds have already left the
-- platform, and it removes the fabricated refund state.

-- ---------------------------------------------------------------------------
-- 1. Enum types
-- ---------------------------------------------------------------------------

CREATE TYPE "DisputeOutcome" AS ENUM ('OPEN', 'WON', 'LOST', 'PREVENTED', 'UNKNOWN');

CREATE TYPE "DisputeReversalState" AS ENUM ('PENDING', 'REVERSED', 'FAILED');

-- ---------------------------------------------------------------------------
-- 2. Payment — durable dispute state
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment"
  ADD COLUMN "stripeDisputeId" TEXT,
  ADD COLUMN "disputeStatus" TEXT,
  ADD COLUMN "disputeReason" TEXT,
  ADD COLUMN "disputeOutcome" "DisputeOutcome",
  ADD COLUMN "disputeOpenedAt" TIMESTAMP(3),
  ADD COLUMN "disputeClosedAt" TIMESTAMP(3),
  ADD COLUMN "disputeEventAt" INTEGER;

-- One dispute per payment: concurrent / redelivered dispute events race on
-- this constraint instead of double-processing (same pattern as
-- Payment.stripeCheckoutSessionId).
CREATE UNIQUE INDEX "Payment_stripeDisputeId_key" ON "Payment"("stripeDisputeId");

-- ---------------------------------------------------------------------------
-- 3. ValueGap — transfer-reversal state
--
-- releaseReason is intentionally left alone: it must keep carrying the
-- original release reason (SWAP_COMPLETED / TRANSFER_FAILED / ...).
-- ---------------------------------------------------------------------------

ALTER TABLE "ValueGap"
  ADD COLUMN "disputeReversalState" "DisputeReversalState",
  ADD COLUMN "disputeReversalAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "disputeReversalAt" TIMESTAMP(3);

CREATE INDEX "ValueGap_disputeReversalState_idx" ON "ValueGap"("disputeReversalState");

-- ---------------------------------------------------------------------------
-- 4. DisputeEventObservation — durable capture + replay
--
-- Written BEFORE the event is applied so a dispute that arrives before
-- checkout.session.completed has linked the payment_intent is never dropped.
-- ---------------------------------------------------------------------------

CREATE TABLE "DisputeEventObservation" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "disputeStatus" TEXT,
    "disputeReason" TEXT,
    "eventCreated" INTEGER,
    "consumed" BOOLEAN NOT NULL DEFAULT false,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisputeEventObservation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DisputeEventObservation_stripeEventId_key" ON "DisputeEventObservation"("stripeEventId");

CREATE INDEX "DisputeEventObservation_consumed_idx" ON "DisputeEventObservation"("consumed");

CREATE INDEX "DisputeEventObservation_stripeDisputeId_idx" ON "DisputeEventObservation"("stripeDisputeId");

-- ---------------------------------------------------------------------------
-- 5. Data remediation — remove fabricated refund state
--
-- A Stripe dispute id begins with 'dp_'; a Stripe refund id begins with 're_'.
-- A 'dp_' value in stripeRefundId is by construction not a refund id, so it is
-- moved to the new dispute column and both refund markers are cleared. This
-- restores the invariant  refundedAt IS NOT NULL  <=>  a confirmed Stripe
-- Refund is recorded in stripeRefundId.
--
-- Payments whose refund id was overwritten by the old handler can no longer be
-- proven refunded from the database alone; clearing them is the only state the
-- evidence supports. They must be re-verified against Stripe before any
-- refund is considered complete.
-- ---------------------------------------------------------------------------

UPDATE "Payment"
SET "stripeDisputeId" = "stripeRefundId",
    "stripeRefundId" = NULL,
    "refundedAt" = NULL,
    "disputeOutcome" = 'OPEN',
    "disputeOpenedAt" = CURRENT_TIMESTAMP
WHERE "stripeRefundId" IS NOT NULL
  AND LEFT("stripeRefundId", 3) = 'dp_'
  AND "stripeDisputeId" IS NULL;

-- ---------------------------------------------------------------------------
-- 6. Fail-closed guards — refuse the migration if the R2 invariant still fails
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Payment"
    WHERE "refundedAt" IS NOT NULL
      AND ("stripeRefundId" IS NULL OR LEFT("stripeRefundId", 3) = 'dp_')
  ) THEN
    RAISE EXCEPTION 'R2 invariant violated: Payment.refundedAt is set without a confirmed Stripe refund id. Refusing to migrate — investigate these Payment rows before deploying.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Payment"
    WHERE "stripeRefundId" IS NOT NULL
      AND "stripeRefundId" = "stripeDisputeId"
  ) THEN
    RAISE EXCEPTION 'R2 invariant violated: Payment.stripeRefundId still holds a dispute id. Refusing to migrate.';
  END IF;
END $$;
