"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SPARK_PACK_PRICES = exports.PAYMENTS_ENABLED = void 0;
exports.isRazorpayConfigured = isRazorpayConfigured;
exports.getRazorpayClient = getRazorpayClient;
exports.verifyCheckoutSignature = verifyCheckoutSignature;
exports.verifyWebhookSignature = verifyWebhookSignature;
exports.membershipAmountInPaise = membershipAmountInPaise;
exports.nextRenewalDate = nextRenewalDate;
const crypto_1 = __importDefault(require("crypto"));
const razorpay_1 = __importDefault(require("razorpay"));
/**
 * Master off switch for the whole billing feature. Every route in
 * routes/billing.ts checks this FIRST and 503s if it's not "true" — so
 * setting RAZORPAY_KEY_ID/SECRET alone does nothing by itself; both this
 * flag AND the keys have to be set before a single rupee can move.
 *
 * This is deliberately a separate, server-only flag from the frontend's
 * PREMIUM_PAYMENTS_ENABLED (lib/premium.ts) — the frontend flag only
 * controls whether buy/subscribe buttons render as clickable, which is a UI
 * nicety, not a security boundary. This one is the real boundary: even if
 * someone bypassed the frontend and called the API directly, nothing here
 * executes until an operator explicitly flips PAYMENTS_ENABLED on the
 * backend too.
 *
 * To go live: set PAYMENTS_ENABLED=true, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
 * (and ideally RAZORPAY_WEBHOOK_SECRET) on the backend, set
 * NEXT_PUBLIC_RAZORPAY_KEY_ID on the frontend, and flip
 * PREMIUM_PAYMENTS_ENABLED to true in the frontend's lib/premium.ts.
 */
exports.PAYMENTS_ENABLED = process.env.PAYMENTS_ENABLED === "true";
function isRazorpayConfigured() {
    return Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);
}
let client = null;
/** Lazily constructs the SDK client so a missing key doesn't crash the
 * process at import time — routes check isRazorpayConfigured()/PAYMENTS_ENABLED
 * before ever calling this. */
function getRazorpayClient() {
    if (!isRazorpayConfigured()) {
        throw new Error("Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing).");
    }
    if (!client) {
        client = new razorpay_1.default({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
        });
    }
    return client;
}
/**
 * Verifies the signature Razorpay's Checkout returns to the browser after a
 * successful payment (order_id + payment_id + signature). Per Razorpay's
 * docs: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 * This MUST be checked server-side before crediting anything — the values
 * posted from the browser are otherwise fully attacker-controlled.
 */
function verifyCheckoutSignature(params) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret)
        return false;
    const expected = crypto_1.default
        .createHmac("sha256", secret)
        .update(`${params.orderId}|${params.paymentId}`)
        .digest("hex");
    return timingSafeEqualHex(expected, params.signature);
}
/**
 * Verifies a webhook payload's signature (different scheme from the
 * checkout signature above: HMAC_SHA256 of the *raw request body* against
 * RAZORPAY_WEBHOOK_SECRET, sent in the X-Razorpay-Signature header). Only
 * meaningful once a webhook is configured in the Razorpay dashboard — the
 * /verify route covers the common path (user completes checkout in-browser)
 * on its own, the webhook is a resilience backstop for the cases where the
 * browser never calls back (closed tab, network drop, etc).
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret || !signatureHeader)
        return false;
    const expected = crypto_1.default.createHmac("sha256", secret).update(rawBody).digest("hex");
    return timingSafeEqualHex(expected, signatureHeader);
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, "hex");
    const bufB = Buffer.from(b, "hex");
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
exports.SPARK_PACK_PRICES = {
    s200: { sparks: 200 + 40, amountInPaise: 16900 }, // ₹169
    s1000: { sparks: 1000 + 200, amountInPaise: 84900 }, // ₹849
    s1500: { sparks: 1500 + 300, amountInPaise: 124900 }, // ₹1,249
    s3000: { sparks: 3000 + 600, amountInPaise: 249900 }, // ₹2,499
    s5000: { sparks: 5000 + 1200, amountInPaise: 419900 }, // ₹4,199
    s10000: { sparks: 10000 + 4000, amountInPaise: 839900 }, // ₹8,399
};
const MEMBERSHIP_MONTHLY_PAISE = {
    plus: 109900, // ₹1,099 / mo
    ultra: 169900, // ₹1,699 / mo
    supreme: 419900, // ₹4,199 / mo
};
// Mirrors cycleMultiplier() in the frontend's lib/premium.ts.
function cycleMultiplier(cycle) {
    if (cycle === "quarterly")
        return 2.85;
    if (cycle === "yearly")
        return 10;
    return 1;
}
function membershipAmountInPaise(tier, cycle) {
    return Math.round(MEMBERSHIP_MONTHLY_PAISE[tier] * cycleMultiplier(cycle));
}
function nextRenewalDate(cycle, from = new Date()) {
    const d = new Date(from);
    if (cycle === "monthly")
        d.setMonth(d.getMonth() + 1);
    else if (cycle === "quarterly")
        d.setMonth(d.getMonth() + 3);
    else
        d.setFullYear(d.getFullYear() + 1);
    return d;
}
