-- AlterTable
ALTER TABLE "Swap" ADD COLUMN     "offeringUserConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "requestedUserConfirmedAt" TIMESTAMP(3);
