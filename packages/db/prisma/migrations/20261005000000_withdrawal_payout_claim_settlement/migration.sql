-- Phase R1: withdrawal payout claim + settlement markers.
--
-- Adds the three columns and one status value required to make the withdrawal
-- state machine recoverable, plus one index for the reconciler scan.
--
-- payoutClaimedAt / payoutClaimId  Durable claim taken before Stripe is
--                                  contacted. Not an idempotency key.
-- settledAt                        Set in the same transaction that releases
--                                  the pending reservation for a terminal
--                                  financial state.
-- PAYOUT_CREATING                  Explicit claim state: reservation is held,
--                                  cancellation is no longer permitted, and
--                                  the Stripe payout result may be unknown.
--
-- The backfill below sets the new markers on rows created by pre-R1 code so
-- that the post-migration invariants (reversedAt / settledAt <=> reservation
-- released) hold for historical data as well as new rows. It refuses to guess.

-- AlterEnum
ALTER TYPE "WithdrawalStatus" ADD VALUE 'PAYOUT_CREATING';

-- AlterTable
ALTER TABLE "Withdrawal" ADD COLUMN     "payoutClaimId" TEXT,
ADD COLUMN     "payoutClaimedAt" TIMESTAMP(3),
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Withdrawal_status_payoutClaimedAt_idx" ON "Withdrawal"("status", "payoutClaimedAt");

-- ---------------------------------------------------------------------------
-- Backfill (guarded)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  -- Rows whose reversal was fully applied by pre-R1 code: the WITHDRAWAL_REVERSAL
  -- ledger entry and the balance movement were always written in the SAME
  -- transaction by every pre-R1 code path, so the entry's existence proves the
  -- reservation was returned.
  v_reversed INT;
  -- COMPLETED rows created before settledAt existed.
  v_completed INT;
  -- Reservations that should still be held after the reversal backfill.
  v_expected_pending BIGINT;
  -- Reservations actually held.
  v_actual_pending BIGINT;
BEGIN
  SELECT count(*) INTO v_reversed
  FROM "Withdrawal" w
  WHERE w."status" IN ('FAILED', 'CANCELLED')
    AND w."reversedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "BalanceEntry" be
      WHERE be."referenceType" = 'WITHDRAWAL_REVERSAL'
        AND be."referenceId" = w."id"
    );

  UPDATE "Withdrawal" w
  SET "reversedAt" = COALESCE(w."failedAt", w."cancelledAt", w."updatedAt"),
      "settledAt"  = COALESCE(w."failedAt", w."cancelledAt", w."updatedAt")
  WHERE w."status" IN ('FAILED', 'CANCELLED')
    AND w."reversedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM "BalanceEntry" be
      WHERE be."referenceType" = 'WITHDRAWAL_REVERSAL'
        AND be."referenceId" = w."id"
    );

  SELECT count(*) INTO v_completed
  FROM "Withdrawal"
  WHERE "status" = 'COMPLETED' AND "settledAt" IS NULL;

  IF v_completed > 0 THEN
    -- Pre-R1 payout.paid released the pending reservation outside any
    -- transaction, so a COMPLETED row gives no local proof that the release
    -- happened. Rather than guess, verify it arithmetically: after the
    -- reversal backfill above, every reservation that should still be held is
    -- exactly the sum over rows still marked unsettled EXCLUDING the COMPLETED
    -- rows we are about to mark settled. If that equals the pending total the
    -- ledger actually reports, every COMPLETED release did happen.
    SELECT COALESCE(SUM(w."amountPence"), 0) INTO v_expected_pending
    FROM "Withdrawal" w
    WHERE w."settledAt" IS NULL
      AND w."status" <> 'COMPLETED';

    SELECT COALESCE(SUM(b."pendingBalancePence"), 0) INTO v_actual_pending
    FROM "BalanceAccount" b;

    IF v_actual_pending <> v_expected_pending THEN
      RAISE EXCEPTION
        'R1 settlement backfill refused: pendingBalancePence total is %, expected % after excluding % COMPLETED row(s). This means at least one COMPLETED withdrawal still holds its reservation (the P2 BLOCKER 1 condition) and the correct rows cannot be identified from local evidence. Resolve manually before migrating.',
        v_actual_pending, v_expected_pending, v_completed;
    END IF;

    UPDATE "Withdrawal"
    SET "settledAt" = COALESCE("completedAt", "updatedAt")
    WHERE "status" = 'COMPLETED' AND "settledAt" IS NULL;
  END IF;

  RAISE NOTICE 'R1 backfill: % reversal marker(s) set, % settlement marker(s) set',
    v_reversed, v_completed;
END $$;
