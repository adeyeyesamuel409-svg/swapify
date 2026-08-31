-- Prevent zero or negative balance entries at the database level.
-- All balance entries must move exactly ≥ £0.01 (1 pence).
ALTER TABLE "BalanceEntry"
  ADD CONSTRAINT "BalanceEntry_amountPence_positive"
  CHECK ("amountPence" > 0);
