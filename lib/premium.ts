/**
 * Premium / wallet infrastructure — UI is built now; payments stay OFF until
 * PREMIUM_PAYMENTS_ENABLED is flipped later.
 */
export const PREMIUM_PAYMENTS_ENABLED = false;

/** In-app currency name (not copied from any other product). */
export const SPARK_CURRENCY = "Sparks";

export type BillingCycle = "monthly" | "quarterly" | "yearly";

export type MembershipTierId = "free" | "plus" | "ultra" | "supreme";

export type MembershipTier = {
  id: MembershipTierId;
  name: string;
  tagline: string;
  /** Display price per month (USD) — not charged while payments disabled. */
  monthlyPrice: number;
  accent: "neutral" | "silver" | "gold" | "rainbow";
  features: string[];
  highlight?: boolean;
};

export const MEMBERSHIP_TIERS: MembershipTier[] = [
  {
    id: "free",
    name: "Free",
    tagline: "Everything you need to start roleplaying.",
    monthlyPrice: 0,
    accent: "neutral",
    features: [
      "2 free chat engines",
      "Unlimited private characters",
      "Community explore gallery",
      "Voice playback (when configured)",
    ],
  },
  {
    id: "plus",
    name: "Plus",
    tagline: "More models, smoother sessions, no distractions.",
    monthlyPrice: 12.99,
    accent: "silver",
    features: [
      "No ads (when we add them)",
      "6 premium roleplay engines",
      "Extended memory span",
      "Priority provider routing",
      "500 Sparks / month",
    ],
  },
  {
    id: "ultra",
    name: "Ultra",
    tagline: "For daily deep roleplay and richer scenes.",
    monthlyPrice: 19.99,
    accent: "gold",
    highlight: true,
    features: [
      "Everything in Plus",
      "2,000 Sparks / month",
      "All premium engines included",
      "Longer context window",
      "Early access features",
    ],
  },
  {
    id: "supreme",
    name: "Supreme",
    tagline: "Maximum control and flagship engines.",
    monthlyPrice: 49.99,
    accent: "rainbow",
    features: [
      "Everything in Ultra",
      "8 flagship engines",
      "Save on Spark top-ups",
      "Highest memory limits",
      "Creator spotlight slot",
    ],
  },
];

export type SparkPackId = "s200" | "s1000" | "s1500" | "s3000" | "s5000" | "s10000";

export type SparkPack = {
  id: SparkPackId;
  sparks: number;
  bonus: number;
  priceUsd: number;
};

export const SPARK_PACKS: SparkPack[] = [
  { id: "s200", sparks: 200, bonus: 40, priceUsd: 1.99 },
  { id: "s1000", sparks: 1000, bonus: 200, priceUsd: 9.99 },
  { id: "s1500", sparks: 1500, bonus: 300, priceUsd: 14.99 },
  { id: "s3000", sparks: 3000, bonus: 600, priceUsd: 29.99 },
  { id: "s5000", sparks: 5000, bonus: 1200, priceUsd: 49.99 },
  { id: "s10000", sparks: 10000, bonus: 4000, priceUsd: 99.99 },
];

/** Shown in UI while payments are off — users get full access anyway. */
export const EARLY_ACCESS_MESSAGE =
  "Early access — everything is free right now. Premium & Sparks launch later.";

export function cycleMultiplier(cycle: BillingCycle): number {
  if (cycle === "quarterly") return 2.85;
  if (cycle === "yearly") return 10;
  return 1;
}

export function formatPrice(usd: number): string {
  return usd.toFixed(2);
}
