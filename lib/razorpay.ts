import { apiFetch } from "./api";
import type { SparkPackId } from "./premium";
import type { MembershipTierId, BillingCycle } from "./premium";

/**
 * Public Razorpay Key ID (safe to expose client-side — it identifies the
 * account, it isn't a secret). Unset until billing goes live; see the
 * backend's README ("Turning on billing (Razorpay) later") for the full
 * checklist, and lib/premium.ts for the master PREMIUM_PAYMENTS_ENABLED
 * switch that gates every button that could call into this file.
 */
export const RAZORPAY_KEY_ID = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || "";

const CHECKOUT_SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads Razorpay's Checkout.js exactly once, however many times this is called. */
function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout can only run in the browser."));
  }
  if (window.Razorpay) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load the payment form. Check your connection and try again."));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

type CheckoutOrder = { orderId: string; amount: number; currency: string; keyId: string };

async function createOrder(path: string, body: Record<string, unknown>): Promise<CheckoutOrder> {
  const res = await apiFetch(path, { method: "POST", body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Couldn't start checkout.");
  }
  return data as CheckoutOrder;
}

export type CheckoutResult =
  | { ok: true }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: "error"; error: string };

/**
 * Runs one full Razorpay Checkout round trip: create the order on our
 * backend, open the Checkout modal, and verify the payment server-side once
 * the user completes it. Resolves rather than throws for a user-cancelled
 * modal (that's a normal outcome, not an error to surface as a failure).
 */
async function runCheckout(
  order: CheckoutOrder,
  prefill: { name?: string; email?: string }
): Promise<CheckoutResult> {
  await loadCheckoutScript();
  if (!window.Razorpay) {
    return { ok: false, reason: "error", error: "Payment form failed to load." };
  }

  return new Promise((resolve) => {
    const rzp = new window.Razorpay!({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      order_id: order.orderId,
      name: "Rolichat",
      prefill,
      theme: { color: "#c9a227" },
      modal: {
        ondismiss: () => resolve({ ok: false, reason: "cancelled" }),
      },
      handler: async (response: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        try {
          const verifyRes = await apiFetch("/api/billing/verify", {
            method: "POST",
            body: JSON.stringify(response),
          });
          const data = await verifyRes.json().catch(() => ({}));
          if (!verifyRes.ok) {
            resolve({ ok: false, reason: "error", error: data.error || "Payment could not be verified." });
            return;
          }
          resolve({ ok: true });
        } catch {
          resolve({ ok: false, reason: "error", error: "Payment could not be verified." });
        }
      },
    });
    rzp.open();
  });
}

export async function buySparkPack(
  packId: SparkPackId,
  prefill: { name?: string; email?: string } = {}
): Promise<CheckoutResult> {
  const order = await createOrder("/api/billing/checkout/spark-pack", { packId });
  return runCheckout(order, prefill);
}

export async function subscribeMembership(
  tier: MembershipTierId,
  cycle: BillingCycle,
  prefill: { name?: string; email?: string } = {}
): Promise<CheckoutResult> {
  const order = await createOrder("/api/billing/checkout/membership", { tier, cycle });
  return runCheckout(order, prefill);
}
