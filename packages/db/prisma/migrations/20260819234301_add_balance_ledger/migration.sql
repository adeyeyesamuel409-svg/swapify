-- CreateEnum
CREATE TYPE "BalanceEntryType" AS ENUM ('VALUE_GAP_CREDIT', 'WITHDRAWAL_DEBIT', 'WITHDRAWAL_REVERSAL', 'ADMIN_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "BalanceEntryDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateTable
CREATE TABLE "BalanceAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "availableBalancePence" INTEGER NOT NULL DEFAULT 0,
    "pendingBalancePence" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BalanceAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceEntry" (
    "id" TEXT NOT NULL,
    "balanceAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "BalanceEntryType" NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "direction" "BalanceEntryDirection" NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "valueGapId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BalanceAccount_userId_key" ON "BalanceAccount"("userId");

-- CreateIndex
CREATE INDEX "BalanceAccount_userId_idx" ON "BalanceAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceEntry_valueGapId_key" ON "BalanceEntry"("valueGapId");

-- CreateIndex
CREATE INDEX "BalanceEntry_balanceAccountId_createdAt_idx" ON "BalanceEntry"("balanceAccountId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BalanceEntry_userId_createdAt_idx" ON "BalanceEntry"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BalanceEntry_valueGapId_idx" ON "BalanceEntry"("valueGapId");

-- CreateIndex
CREATE UNIQUE INDEX "BalanceEntry_referenceType_referenceId_key" ON "BalanceEntry"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "BalanceAccount" ADD CONSTRAINT "BalanceAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_balanceAccountId_fkey" FOREIGN KEY ("balanceAccountId") REFERENCES "BalanceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_valueGapId_fkey" FOREIGN KEY ("valueGapId") REFERENCES "ValueGap"("id") ON DELETE SET NULL ON UPDATE CASCADE;
