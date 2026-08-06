-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_offeringUserId_fkey" FOREIGN KEY ("offeringUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Swap" ADD CONSTRAINT "Swap_requestedUserId_fkey" FOREIGN KEY ("requestedUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
