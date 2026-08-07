"use client";

import { useState } from "react";
import Link from "next/link";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import PremiumActionButton, { PremiumLockBadge } from "@/components/PremiumActionButton";
import { EARLY_ACCESS_MESSAGE, SPARK_CURRENCY, SPARK_PACKS, type SparkPackId } from "@/lib/premium";
import { buySparkPack } from "@/lib/razorpay";

export default function WalletPage() {
  // Only reachable once PREMIUM_PAYMENTS_ENABLED flips to true — until then
  // PremiumActionButton renders disabled and never fires onClick at all.
  const [buyingId, setBuyingId] = useState<SparkPackId | null>(null);
  const [buyError, setBuyError] = useState("");

  async function onBuyPack(packId: SparkPackId) {
    setBuyError("");
    setBuyingId(packId);
    try {
      const result = await buySparkPack(packId);
      if (!result.ok && result.reason === "error") {
        setBuyError(result.error);
      }
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Couldn't start checkout.");
    } finally {
      setBuyingId(null);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <div className="flex-1 overflow-y-auto px-4 md:px-10 py-8 max-w-5xl mx-auto w-full">
          <header className="flex items-center justify-between mb-8">
            <h1 className="font-display text-2xl">Wallet</h1>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="text-sm text-parchment/40 border border-white/10 px-4 py-1.5 rounded-full cursor-not-allowed"
            >
              Transactions
            </button>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            <div className="rounded-2xl bg-surface-card border border-white/10 p-6 flex items-center gap-4">
              <span className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/30 to-rose-400/30 flex items-center justify-center text-3xl">
                ✨
              </span>
              <div>
                <p className="text-sm text-parchment/45">{SPARK_CURRENCY}</p>
                <p className="text-4xl font-semibold">∞</p>
                <p className="text-xs text-gold/80 mt-1">Free during early access</p>
              </div>
            </div>

            <Link
              href="/plus"
              className="rounded-2xl promo-banner border border-gold/20 p-6 flex flex-col justify-center focus-ring"
            >
              <p className="text-xs uppercase tracking-wider text-gold/90 mb-1">Join Rolichat+ membership</p>
              <p className="text-lg font-display">5 premium engines · extended memory · no ads (later)</p>
              <PremiumLockBadge />
            </Link>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display text-lg">Buy {SPARK_CURRENCY}</h2>
            <span className="text-xs text-parchment/40">What are Sparks? — in-app credits for extras (later)</span>
          </div>

          <p className="text-xs text-parchment/45 mb-4">{EARLY_ACCESS_MESSAGE}</p>
          {buyError && <p className="text-xs text-rose-400 mb-4">{buyError}</p>}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {SPARK_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="rounded-2xl bg-surface-card border border-white/10 p-3 flex flex-col items-center text-center"
              >
                <span className="text-[10px] text-gold mb-1">Bonus +{pack.bonus}</span>
                <span className="text-2xl mb-1" aria-hidden>
                  ✨
                </span>
                <p className="text-lg font-semibold">{pack.sparks.toLocaleString()}</p>
                <PremiumActionButton
                  variant="ghost"
                  className="w-full text-xs py-2 mt-auto"
                  onClick={() => onBuyPack(pack.id)}
                  disabled={buyingId === pack.id}
                >
                  {buyingId === pack.id ? "Opening…" : `USD ${pack.priceUsd.toFixed(2)}`}
                </PremiumActionButton>
              </div>
            ))}
          </div>

          <p className="text-center text-[11px] text-parchment/30 mt-10">
            Purchasing will mean you accept our{" "}
            <Link href="/privacy" className="hover:text-gold">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href="/terms" className="hover:text-gold">
              Terms
            </Link>{" "}
            when payments go live.
          </p>
        </div>
      </AppShell>
    </RequireAuth>
  );
}
