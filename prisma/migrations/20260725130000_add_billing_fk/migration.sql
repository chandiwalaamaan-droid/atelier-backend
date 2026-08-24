-- Split out from 20260725130000_add_billing: PaymentOrder needs to already
-- be unlocked, which only takes effect once that migration's transaction
-- has fully committed.

ALTER TABLE "PaymentOrder"
    ADD CONSTRAINT "PaymentOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
