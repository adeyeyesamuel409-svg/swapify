-- CreateEnum
CREATE TYPE "ValueGapState" AS ENUM ('PENDING', 'HELD', 'RELEASED', 'REFUNDED');

-- CreateTable
CREATE TABLE "ValueGap" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "swapId" TEXT NOT NULL,
    "payerUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "valueGapPence" INTEGER NOT NULL,
    "serviceFeePence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "state" "ValueGapState" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heldAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "refundReason" TEXT,
    "externalPayoutRef" TEXT,

    CONSTRAINT "ValueGap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ValueGap_paymentId_key" ON "ValueGap"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ValueGap_swapId_key" ON "ValueGap"("swapId");

-- CreateIndex
CREATE INDEX "ValueGap_swapId_idx" ON "ValueGap"("swapId");

-- CreateIndex
CREATE INDEX "ValueGap_payerUserId_idx" ON "ValueGap"("payerUserId");

-- CreateIndex
CREATE INDEX "ValueGap_recipientUserId_idx" ON "ValueGap"("recipientUserId");

-- CreateIndex
CREATE INDEX "ValueGap_state_idx" ON "ValueGap"("state");

-- CreateIndex
CREATE INDEX "ValueGap_createdAt_idx" ON "ValueGap"("createdAt");

-- AddForeignKey
ALTER TABLE "ValueGap" ADD CONSTRAINT "ValueGap_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueGap" ADD CONSTRAINT "ValueGap_swapId_fkey" FOREIGN KEY ("swapId") REFERENCES "Swap"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueGap" ADD CONSTRAINT "ValueGap_payerUserId_fkey" FOREIGN KEY ("payerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueGap" ADD CONSTRAINT "ValueGap_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
