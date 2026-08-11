-- Remove the token economy (Wallet/ledger/escrow/token-orders) and switch
-- money to integer GBP pence. Existing micro-token values convert at
-- 1 token = £1 = 100 pence, so pence = microTokens / 10000.

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable Payment (the single Stripe payment per swap: gap + service fee)
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "feePence" INTEGER NOT NULL,
    "totalPence" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_swapId_key" ON "Payment"("swapId");
CREATE UNIQUE INDEX "Payment_stripeCheckoutSessionId_key" ON "Payment"("stripeCheckoutSessionId");
CREATE INDEX "Payment_payerUserId_createdAt_idx" ON "Payment"("payerUserId", "createdAt" DESC);

-- Item: valueMicroTokens -> valuePence
ALTER TABLE "Item" ADD COLUMN "valuePence" INTEGER;
UPDATE "Item" SET "valuePence" = ("valueMicroTokens" / 10000)::INTEGER;
ALTER TABLE "Item" ALTER COLUMN "valuePence" SET NOT NULL;
ALTER TABLE "Item" DROP COLUMN "valueMicroTokens";

-- Swap: gapMicroTokens -> gapPence
ALTER TABLE "Swap" ADD COLUMN "gapPence" INTEGER NOT NULL DEFAULT 0;
UPDATE "Swap" SET "gapPence" = ("gapMicroTokens" / 10000)::INTEGER;
ALTER TABLE "Swap" DROP COLUMN "gapMicroTokens";

-- Wishlist: maxValueMicroTokens -> maxValuePence
ALTER TABLE "Wishlist" ADD COLUMN "maxValuePence" INTEGER;
UPDATE "Wishlist" SET "maxValuePence" = ("maxValueMicroTokens" / 10000)::INTEGER;
ALTER TABLE "Wishlist" DROP COLUMN "maxValueMicroTokens";

-- SwapStatus: no more escrow; the gap payment is the funding step.
ALTER TYPE "SwapStatus" RENAME VALUE 'ESCROWED' TO 'PAID';

-- Drop the token economy.
DROP TABLE "EscrowHold";
DROP TABLE "TokenOrder";
DROP TABLE "TokenTransaction";
DROP TABLE "Wallet";

DROP TYPE "EscrowStatus";
DROP TYPE "TokenOrderStatus";
DROP TYPE "TransactionDirection";
DROP TYPE "TransactionType";

-- AddForeignKey Payment
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
