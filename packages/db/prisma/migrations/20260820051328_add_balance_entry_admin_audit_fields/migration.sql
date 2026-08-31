-- AlterTable
ALTER TABLE "BalanceEntry" ADD COLUMN     "adminUserId" TEXT,
ADD COLUMN     "reason" TEXT;

-- AddForeignKey
ALTER TABLE "BalanceEntry" ADD CONSTRAINT "BalanceEntry_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
