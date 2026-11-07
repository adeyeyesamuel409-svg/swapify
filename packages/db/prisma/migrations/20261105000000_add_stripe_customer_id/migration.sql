-- Saved payment cards (buyer side): a Stripe Customer per user. Card details
-- live only in Stripe; we store the customer reference.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "stripeCustomerId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");
