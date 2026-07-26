-- Billing (Razorpay) scaffolding. Additive only, defaults keep every
-- existing row unaffected, and the app doesn't call any of this until
-- PAYMENTS_ENABLED=true is set (see src/lib/payments/razorpay.ts).

-- ── User: spark balance + membership state ───────────────────────────────
ALTER TABLE "User" ADD COLUMN "sparkBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "membershipTier" TEXT NOT NULL DEFAULT 'free';
ALTER TABLE "User" ADD COLUMN "membershipRenewsAt" TIMESTAMP(3);

-- ── PaymentOrder ──────────────────────────────────────────────────────────
CREATE TABLE "PaymentOrder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "billingCycle" TEXT,
    "amountInPaise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'created',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentOrder_razorpayOrderId_key" ON "PaymentOrder"("razorpayOrderId");
CREATE INDEX "PaymentOrder_userId_idx" ON "PaymentOrder"("userId");
CREATE INDEX "PaymentOrder_razorpayOrderId_idx" ON "PaymentOrder"("razorpayOrderId");

ALTER TABLE "PaymentOrder"
    ADD CONSTRAINT "PaymentOrder_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
