-- CreateEnum
CREATE TYPE "TokenOrderStatus" AS ENUM ('PENDING', 'PAID', 'FAILED');

-- CreateTable
CREATE TABLE "TokenOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "tokens" BIGINT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" "TokenOrderStatus" NOT NULL DEFAULT 'PENDING',
    "stripeCheckoutSessionId" TEXT,
    "stripePaymentIntentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "TokenOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TokenOrder_stripeCheckoutSessionId_key" ON "TokenOrder"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "TokenOrder_userId_createdAt_idx" ON "TokenOrder"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "TokenOrder" ADD CONSTRAINT "TokenOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
