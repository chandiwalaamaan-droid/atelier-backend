"use client";

import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import PremiumActionButton from "@/components/PremiumActionButton";
import {
  EARLY_ACCESS_MESSAGE,
  MEMBERSHIP_TIERS,
  cycleMultiplier,
  formatPrice,
  type BillingCycle,
  type MembershipTierId,
} from "@/lib/premium";
import { subscribeMembership } from "@/lib/razorpay";
import { useState } from "react";

export default function PlusPage() {
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [subscribingId, setSubscribingId] = useState<MembershipTierId | null>(null);
  const [subscribeError, setSubscribeError] = useState("");

  async function onSubscribe(tier: Exclude<MembershipTierId, "free">) {
    setSubscribeError("");
    setSubscribingId(tier);
    try {
      const result = await subscribeMembership(tier, cycle);
      if (!result.ok && result.reason === "error") {
        setSubscribeError(result.error);
      }
    } catch (err) {
      setSubscribeError(err instanceof Error ? err.message : "Couldn't start checkout.");
    } finally {
      setSubscribingId(null);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <div className="flex-1 overflow-y-auto px-4 md:px-10 py-8">
          <header className="text-center max-w-2xl mx-auto mb-10">
            <span className="text-4xl block mb-3">♛</span>
            <h1 className="font-display text-3xl md:text-4xl mb-2 gradient-text">Get unlimited access on Rolichat</h1>
            <p className="text-sm text-parchment/50">
              Higher tiers unlock more premium engines and memory — billing is not active yet.
            </p>
            <p className="text-xs text-gold/80 mt-3 inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gold/10 border border-gold/20">
              <span className="w-1.5 h-1.5 rounded-full bg-gold animate-sparkle" />
              {EARLY_ACCESS_MESSAGE}
            </p>
            {subscribeError && <p className="text-xs text-rose mt-3">{subscribeError}</p>}
          </header>

          <div className="flex justify-center gap-2 mb-10">
            {(
              [
                ["monthly", "Monthly"],
                ["quarterly", "Quarterly"],
                ["yearly", "Yearly"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCycle(id)}
                className={`px-5 py-2 rounded-full text-sm focus-ring border transition-all ${
                  cycle === id
                    ? "bg-gradient-to-r from-gold/20 to-gold/10 border-gold/30 text-parchment shadow-sm"
                    : "border-white/10 text-parchment/50 hover:text-parchment/70 hover:bg-white/5"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4 max-w-6xl mx-auto">
            {MEMBERSHIP_TIERS.map((tier) => {
              const price =
                tier.monthlyPrice === 0 ? 0 : tier.monthlyPrice * cycleMultiplier(cycle);
              const cardClass =
                tier.accent === "rainbow"
                  ? "tier-card-glow-rainbow"
                  : tier.accent === "gold"
                    ? "tier-card-glow-gold border-amber-500/30"
                    : "border-white/10";

              return (
                <div
                  key={tier.id}
                  className={`rounded-2xl bg-gradient-to-b from-surface-card to-surface-raised p-5 flex flex-col border ${cardClass} card-hover ${
                    tier.highlight ? "ring-1 ring-gold/40 shadow-lg shadow-gold/5" : ""
                  }`}
                >
                  <div className="mb-4">
                    <p className="font-display text-lg">{tier.name}</p>
                    <p className="text-2xl font-semibold mt-1">
                      {price === 0 ? (
                        <span className="text-parchment/60">Free</span>
                      ) : (
                        <>
                          ${formatPrice(price)}
                          <span className="text-sm font-normal text-parchment/45"> / {cycle === "monthly" ? "mo" : cycle.slice(0, 2)}</span>
                        </>
                      )}
                    </p>
                    <p className="text-xs text-parchment/45 mt-2">{tier.tagline}</p>
                  </div>
                  <ul className="space-y-2 text-xs text-parchment/60 flex-1 mb-5">
                    {tier.features.map((f) => (
                      <li key={f} className="flex gap-2">
                        <span className="text-gold shrink-0">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {tier.id === "free" ? (
                    <button
                      type="button"
                      disabled
                      className="w-full py-2.5 rounded-full bg-white/5 border border-white/10 text-sm text-parchment/50"
                    >
                      Current plan
                    </button>
                  ) : (
                    <PremiumActionButton
                      variant={tier.accent === "gold" ? "gold" : tier.accent === "rainbow" ? "rainbow" : "silver"}
                      className="w-full text-sm py-2.5"
                      onClick={() => onSubscribe(tier.id as Exclude<MembershipTierId, "free">)}
                      disabled={subscribingId === tier.id}
                    >
                      {subscribingId === tier.id ? "Opening…" : "Subscribe"}
                    </PremiumActionButton>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs text-parchment/35 mt-10 max-w-lg mx-auto">
            Subscriptions will connect to payment later. Until then, all engines and chats remain free. See{" "}
            <Link href="/terms" className="text-gold hover:text-gold/80 transition-colors">
              Terms
            </Link>
            .
          </p>
        </div>
      </AppShell>
    </RequireAuth>
  );
}