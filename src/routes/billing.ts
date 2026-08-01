import { Router } from "express";
import type { Prisma, PaymentOrder } from "@prisma/client";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/db";
import { getCurrentUserId } from "../lib/auth";
import { checkRateLimit } from "../lib/rateLimit";
import {
  PAYMENTS_ENABLED,
  isRazorpayConfigured,
  getRazorpayClient,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  SPARK_PACK_PRICES,
  membershipAmountInPaise,
  nextRenewalDate,
  type SparkPackId,
  type MembershipTierId,
  type BillingCycle,
} from "../lib/payments/razorpay";

const router = Router();

// Every route below starts with this. PAYMENTS_ENABLED is off by default —
// see lib/payments/razorpay.ts for why this is a separate, server-only
// switch from the frontend's "buttons are clickable" flag.
function requirePaymentsLive(res: any): boolean {
  if (!PAYMENTS_ENABLED || !isRazorpayConfigured()) {
    res.status(503).json({ error: "Payments aren't live yet." });
    return false;
  }
  return true;
}

// GET /api/billing/me — current spark balance + membership, for the
// wallet/plus pages to render once billing is live.
router.get("/me", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { sparkBalance: true, membershipTier: true, membershipRenewsAt: true },
  });
  if (!user) return res.status(404).json({ error: "Account not found." });

  return res.json({
    paymentsLive: PAYMENTS_ENABLED,
    sparkBalance: user.sparkBalance,
    membershipTier: user.membershipTier,
    membershipRenewsAt: user.membershipRenewsAt,
  });
}));

// POST /api/billing/checkout/spark-pack  { packId }
// Creates a Razorpay order for a spark pack and records it as "created".
// The frontend opens Razorpay Checkout with the returned order, then calls
// /verify once the user completes payment.
router.post("/checkout/spark-pack", asyncHandler(async (req, res) => {
  if (!requirePaymentsLive(res)) return;

  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const limit = checkRateLimit(`billing-checkout:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many checkout attempts. Please slow down." });
  }

  const packId = req.body?.packId as SparkPackId | undefined;
  const pricing = packId ? SPARK_PACK_PRICES[packId] : undefined;
  if (!packId || !pricing) {
    return res.status(400).json({ error: "Unknown spark pack." });
  }

  const order = await getRazorpayClient().orders.create({
    amount: pricing.amountInPaise,
    currency: "INR",
    notes: { userId, kind: "spark_pack", packId },
  });

  await prisma.paymentOrder.create({
    data: {
      userId,
      kind: "spark_pack",
      referenceId: packId,
      amountInPaise: pricing.amountInPaise,
      currency: "INR",
      razorpayOrderId: order.id,
      status: "created",
    },
  });

  return res.json({
    orderId: order.id,
    amount: pricing.amountInPaise,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}));

// POST /api/billing/checkout/membership  { tier, cycle }
router.post("/checkout/membership", asyncHandler(async (req, res) => {
  if (!requirePaymentsLive(res)) return;

  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const limit = checkRateLimit(`billing-checkout:${userId}`, 10, 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many checkout attempts. Please slow down." });
  }

  const tier = req.body?.tier as MembershipTierId | undefined;
  const cycle = req.body?.cycle as BillingCycle | undefined;
  if (!tier || !["plus", "ultra", "supreme"].includes(tier)) {
    return res.status(400).json({ error: "Unknown membership tier." });
  }
  if (!cycle || !["monthly", "quarterly", "yearly"].includes(cycle)) {
    return res.status(400).json({ error: "Unknown billing cycle." });
  }

  const amountInPaise = membershipAmountInPaise(tier, cycle);

  const order = await getRazorpayClient().orders.create({
    amount: amountInPaise,
    currency: "INR",
    notes: { userId, kind: "membership", tier, cycle },
  });

  await prisma.paymentOrder.create({
    data: {
      userId,
      kind: "membership",
      referenceId: tier,
      billingCycle: cycle,
      amountInPaise,
      currency: "INR",
      razorpayOrderId: order.id,
      status: "created",
    },
  });

  return res.json({
    orderId: order.id,
    amount: amountInPaise,
    currency: "INR",
    keyId: process.env.RAZORPAY_KEY_ID,
  });
}));

// POST /api/billing/verify  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Called by the frontend from Razorpay Checkout's success handler. Verifies
// the signature server-side (never trust the browser's word that a payment
// succeeded), then applies the order's effect exactly once.
router.post("/verify", asyncHandler(async (req, res) => {
  if (!requirePaymentsLive(res)) return;

  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const orderId = typeof req.body?.razorpay_order_id === "string" ? req.body.razorpay_order_id : "";
  const paymentId = typeof req.body?.razorpay_payment_id === "string" ? req.body.razorpay_payment_id : "";
  const signature = typeof req.body?.razorpay_signature === "string" ? req.body.razorpay_signature : "";
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: "Missing payment verification fields." });
  }

  const valid = verifyCheckoutSignature({ orderId, paymentId, signature });
  if (!valid) {
    return res.status(400).json({ error: "Payment signature verification failed." });
  }

  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: orderId } });
  if (!order || order.userId !== userId) {
    return res.status(404).json({ error: "Order not found." });
  }

  // Idempotent: Checkout's success handler and the webhook can both land
  // for the same order (or the user could double-click), so only apply the
  // credit/upgrade once.
  if (order.status === "paid") {
    return res.json({ ok: true, alreadyProcessed: true });
  }

  await applyPaidOrder(order.id, paymentId);

  return res.json({ ok: true });
}));

// POST /api/billing/webhook — Razorpay server-to-server notification,
// configured separately in the Razorpay dashboard. Resilience backstop for
// payments whose browser never called /verify (closed tab, dropped
// connection, etc). Needs the RAW request body to check the signature, so
// this path is mounted with express.raw() in server.ts, ahead of the global
// express.json() middleware — see server.ts for why the route has to be
// wired up there rather than here.
export async function handleWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
  if (!PAYMENTS_ENABLED) return { status: 503 as const };
  if (!verifyWebhookSignature(rawBody, signatureHeader)) {
    return { status: 400 as const };
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return { status: 400 as const };
  }

  if (payload?.event !== "payment.captured") {
    // Only payment.captured actually moves an order to "paid" here; other
    // event types (order.paid, payment.failed, etc.) are ignored for now.
    return { status: 200 as const };
  }

  const orderId: string | undefined = payload?.payload?.payment?.entity?.order_id;
  const paymentId: string | undefined = payload?.payload?.payment?.entity?.id;
  if (!orderId || !paymentId) return { status: 200 as const };

  const order = await prisma.paymentOrder.findUnique({ where: { razorpayOrderId: orderId } });
  if (!order || order.status === "paid") return { status: 200 as const };

  await applyPaidOrder(order.id, paymentId);
  return { status: 200 as const };
}

async function applyPaidOrder(orderId: string, razorpayPaymentId: string) {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.$queryRaw<{
      id: string;
      userId: string;
      kind: string;
      referenceId: string;
      billingCycle: string | null;
      status: string;
    }[]>`
      SELECT id, "userId", kind, "referenceId", "billingCycle", status
      FROM "PaymentOrder"
      WHERE id = ${orderId}
      FOR UPDATE
    `;
    const lockedOrder = order[0];
    if (!lockedOrder || lockedOrder.status === "paid") return;

    await tx.paymentOrder.update({
      where: { id: lockedOrder.id },
      data: { status: "paid", razorpayPaymentId, paidAt: new Date() },
    });

    if (lockedOrder.kind === "spark_pack") {
      const pricing = SPARK_PACK_PRICES[lockedOrder.referenceId as SparkPackId];
      await tx.user.update({
        where: { id: lockedOrder.userId },
        data: { sparkBalance: { increment: pricing?.sparks ?? 0 } },
      });
    } else if (lockedOrder.kind === "membership" && lockedOrder.billingCycle) {
      await tx.user.update({
        where: { id: lockedOrder.userId },
        data: {
          membershipTier: lockedOrder.referenceId,
          membershipRenewsAt: nextRenewalDate(lockedOrder.billingCycle as BillingCycle),
        },
      });
    }
  });
}

export default router;
