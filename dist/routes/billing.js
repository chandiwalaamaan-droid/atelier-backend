"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWebhook = handleWebhook;
const express_1 = require("express");
const asyncHandler_1 = require("../lib/asyncHandler");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const rateLimit_1 = require("../lib/rateLimit");
const razorpay_1 = require("../lib/payments/razorpay");
const router = (0, express_1.Router)();
// Every route below starts with this. PAYMENTS_ENABLED is off by default —
// see lib/payments/razorpay.ts for why this is a separate, server-only
// switch from the frontend's "buttons are clickable" flag.
function requirePaymentsLive(res) {
    if (!razorpay_1.PAYMENTS_ENABLED || !(0, razorpay_1.isRazorpayConfigured)()) {
        res.status(503).json({ error: "Payments aren't live yet." });
        return false;
    }
    return true;
}
// GET /api/billing/me — current spark balance + membership, for the
// wallet/plus pages to render once billing is live.
router.get("/me", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId)
        return res.status(401).json({ error: "Not signed in." });
    const user = await db_1.prisma.user.findUnique({
        where: { id: userId },
        select: { sparkBalance: true, membershipTier: true, membershipRenewsAt: true },
    });
    if (!user)
        return res.status(404).json({ error: "Account not found." });
    return res.json({
        paymentsLive: razorpay_1.PAYMENTS_ENABLED,
        sparkBalance: user.sparkBalance,
        membershipTier: user.membershipTier,
        membershipRenewsAt: user.membershipRenewsAt,
    });
}));
// POST /api/billing/checkout/spark-pack  { packId }
// Creates a Razorpay order for a spark pack and records it as "created".
// The frontend opens Razorpay Checkout with the returned order, then calls
// /verify once the user completes payment.
router.post("/checkout/spark-pack", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!requirePaymentsLive(res))
        return;
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId)
        return res.status(401).json({ error: "Not signed in." });
    const limit = (0, rateLimit_1.checkRateLimit)(`billing-checkout:${userId}`, 10, 60);
    if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({ error: "Too many checkout attempts. Please slow down." });
    }
    const packId = req.body?.packId;
    const pricing = packId ? razorpay_1.SPARK_PACK_PRICES[packId] : undefined;
    if (!packId || !pricing) {
        return res.status(400).json({ error: "Unknown spark pack." });
    }
    const order = await (0, razorpay_1.getRazorpayClient)().orders.create({
        amount: pricing.amountInPaise,
        currency: "INR",
        notes: { userId, kind: "spark_pack", packId },
    });
    await db_1.prisma.paymentOrder.create({
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
router.post("/checkout/membership", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!requirePaymentsLive(res))
        return;
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId)
        return res.status(401).json({ error: "Not signed in." });
    const limit = (0, rateLimit_1.checkRateLimit)(`billing-checkout:${userId}`, 10, 60);
    if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({ error: "Too many checkout attempts. Please slow down." });
    }
    const tier = req.body?.tier;
    const cycle = req.body?.cycle;
    if (!tier || !["plus", "ultra", "supreme"].includes(tier)) {
        return res.status(400).json({ error: "Unknown membership tier." });
    }
    if (!cycle || !["monthly", "quarterly", "yearly"].includes(cycle)) {
        return res.status(400).json({ error: "Unknown billing cycle." });
    }
    const amountInPaise = (0, razorpay_1.membershipAmountInPaise)(tier, cycle);
    const order = await (0, razorpay_1.getRazorpayClient)().orders.create({
        amount: amountInPaise,
        currency: "INR",
        notes: { userId, kind: "membership", tier, cycle },
    });
    await db_1.prisma.paymentOrder.create({
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
router.post("/verify", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!requirePaymentsLive(res))
        return;
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId)
        return res.status(401).json({ error: "Not signed in." });
    const orderId = typeof req.body?.razorpay_order_id === "string" ? req.body.razorpay_order_id : "";
    const paymentId = typeof req.body?.razorpay_payment_id === "string" ? req.body.razorpay_payment_id : "";
    const signature = typeof req.body?.razorpay_signature === "string" ? req.body.razorpay_signature : "";
    if (!orderId || !paymentId || !signature) {
        return res.status(400).json({ error: "Missing payment verification fields." });
    }
    const valid = (0, razorpay_1.verifyCheckoutSignature)({ orderId, paymentId, signature });
    if (!valid) {
        return res.status(400).json({ error: "Payment signature verification failed." });
    }
    const order = await db_1.prisma.paymentOrder.findUnique({ where: { razorpayOrderId: orderId } });
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
async function handleWebhook(rawBody, signatureHeader) {
    if (!razorpay_1.PAYMENTS_ENABLED)
        return { status: 503 };
    if (!(0, razorpay_1.verifyWebhookSignature)(rawBody, signatureHeader)) {
        return { status: 400 };
    }
    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        return { status: 400 };
    }
    if (payload?.event !== "payment.captured") {
        // Only payment.captured actually moves an order to "paid" here; other
        // event types (order.paid, payment.failed, etc.) are ignored for now.
        return { status: 200 };
    }
    const orderId = payload?.payload?.payment?.entity?.order_id;
    const paymentId = payload?.payload?.payment?.entity?.id;
    if (!orderId || !paymentId)
        return { status: 200 };
    const order = await db_1.prisma.paymentOrder.findUnique({ where: { razorpayOrderId: orderId } });
    if (!order || order.status === "paid")
        return { status: 200 };
    await applyPaidOrder(order.id, paymentId);
    return { status: 200 };
}
async function applyPaidOrder(orderId, razorpayPaymentId) {
    await db_1.prisma.$transaction(async (tx) => {
        const order = await tx.paymentOrder.findUnique({ where: { id: orderId } });
        if (!order || order.status === "paid")
            return;
        await tx.paymentOrder.update({
            where: { id: order.id },
            data: { status: "paid", razorpayPaymentId, paidAt: new Date() },
        });
        if (order.kind === "spark_pack") {
            const pricing = razorpay_1.SPARK_PACK_PRICES[order.referenceId];
            await tx.user.update({
                where: { id: order.userId },
                data: { sparkBalance: { increment: pricing?.sparks ?? 0 } },
            });
        }
        else if (order.kind === "membership" && order.billingCycle) {
            await tx.user.update({
                where: { id: order.userId },
                data: {
                    membershipTier: order.referenceId,
                    membershipRenewsAt: (0, razorpay_1.nextRenewalDate)(order.billingCycle),
                },
            });
        }
    });
}
exports.default = router;
