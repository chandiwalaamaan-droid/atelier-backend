"use client";

import { PREMIUM_PAYMENTS_ENABLED, EARLY_ACCESS_MESSAGE } from "@/lib/premium";

type Props = {
  children: React.ReactNode;
  className?: string;
  variant?: "primary" | "gold" | "silver" | "rainbow" | "ghost";
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
};

const VARIANTS = {
  primary: "bg-white/10 text-parchment border border-white/15 hover:bg-white/15",
  gold: "bg-gradient-to-r from-amber-400 to-yellow-300 text-ink font-semibold hover:brightness-110",
  silver: "bg-gradient-to-r from-slate-300 to-slate-100 text-ink font-semibold hover:brightness-110",
  rainbow:
    "bg-gradient-to-r from-violet-500 via-rose-400 to-amber-300 text-ink font-semibold hover:brightness-110",
  ghost: "border border-white/20 text-parchment/70 hover:border-white/35",
};

export default function PremiumActionButton({
  children,
  className = "",
  variant = "primary",
  onClick,
  type = "button",
  disabled,
}: Props) {
  if (PREMIUM_PAYMENTS_ENABLED) {
    return (
      <button type={type} onClick={onClick} disabled={disabled} className={`${VARIANTS[variant]} ${className} rounded-full px-5 py-2.5 focus-ring disabled:opacity-50`}>
        {children}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled
      title={EARLY_ACCESS_MESSAGE}
      className={`${VARIANTS[variant]} ${className} rounded-full px-5 py-2.5 opacity-60 cursor-not-allowed relative group`}
    >
      {children}
      <span className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] text-parchment/50 opacity-0 group-hover:opacity-100 pointer-events-none">
        Coming soon
      </span>
    </button>
  );
}

export function PremiumLockBadge() {
  if (PREMIUM_PAYMENTS_ENABLED) return null;
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full border border-gold/30 bg-gold/10 text-gold">
      Free for now
    </span>
  );
}
