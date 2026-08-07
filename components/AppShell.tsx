"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import { EARLY_ACCESS_MESSAGE, PREMIUM_PAYMENTS_ENABLED } from "@/lib/premium";
import Logo from "@/components/Logo";

type ChatPreview = {
  id: string;
  name: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  accentColor: string;
  lastMessagePreview?: string | null;
};

type AppShellProps = {
  children: React.ReactNode;
  variant?: "default" | "chat";
};

const NAV: { href: string; label: string; icon: string; badge?: string }[] = [
  { href: "/explore", label: "Explore", icon: "⌂" },
  { href: "/plus", label: "Rolichat+", icon: "♛", badge: PREMIUM_PAYMENTS_ENABLED ? undefined : "Free" },
  { href: "/wallet", label: "Wallet", icon: "◎" },
  { href: "/dashboard", label: "Studio", icon: "✦" },
  { href: "/me", label: "Me", icon: "◉" },
];

export default function AppShell({ children, variant = "default" }: AppShellProps) {
  const pathname = usePathname();
  const [chats, setChats] = useState<ChatPreview[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => setDisplayName(d.user?.displayName ?? ""))
      .catch(() => {});
    apiFetch("/api/characters")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const list = (d.characters ?? []) as ChatPreview[];
        const withPreview = list.filter((c) => c.lastMessagePreview);
        setChats(withPreview.slice(0, 8));
      })
      .catch(() => setChats([]));
  }, [pathname]);

  return (
    <div className="min-h-screen flex bg-void text-parchment">
      <aside className="hidden md:flex w-[260px] shrink-0 flex-col border-r border-white/5 bg-gradient-to-b from-surface-raised via-surface-raised to-plum-deep/40 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-gold/5 to-transparent opacity-30 pointer-events-none" />
        
        <Link href="/explore" className="flex items-center gap-2.5 px-5 py-5 focus-ring rounded-lg mx-2 mt-2 group relative">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gold/30 to-gold/10 flex items-center justify-center shadow-lg shadow-gold/10 group-hover:shadow-gold/20 group-hover:scale-105 transition-all duration-300">
            <Logo size={24} />
          </div>
          <span className="font-display text-lg tracking-wide shimmer-text">Rolichat</span>
        </Link>

        <nav className="px-3 mt-3 flex-1 relative">
          <div className="space-y-0.5">
            {NAV.map(({ href, label, icon, badge }) => {
              const active = pathname === href || (href === "/dashboard" && pathname?.startsWith("/characters"));
              return (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 focus-ring relative overflow-hidden ${
                    active
                      ? "bg-gradient-to-r from-gold/15 to-gold/5 text-parchment font-medium border border-gold/10 shadow-lg shadow-gold/5"
                      : "text-parchment/55 hover:text-parchment hover:bg-white/5 border border-transparent"
                  }`}
                >
                  {active && (
                    <div className="absolute inset-0 bg-gradient-to-r from-gold/10 to-transparent opacity-50" />
                  )}
                  <span className={`w-5 text-center text-base relative ${active ? "text-gold" : "opacity-80"}`}>{icon}</span>
                  <span className="flex-1 relative">{label}</span>
                  {badge && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gold/25 text-gold border border-gold/30 relative">
                      {badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>

          <div className="pt-8 pb-2 px-3">
            <p className="text-[11px] font-medium text-parchment/30 uppercase tracking-widest flex items-center gap-2">
              <span className="w-4 h-px bg-parchment/10" />
              Chats
              <span className="flex-1 h-px bg-parchment/10" />
            </p>
          </div>
          <div className="space-y-0.5 max-h-[280px] overflow-y-auto scrollbar-thin pr-1">
            {chats.length === 0 && (
              <p className="px-3 py-3 text-xs text-parchment/30 text-center italic">No chats yet</p>
            )}
            {chats.map((c) => (
              <Link
                key={c.id}
                href={`/chat/${c.id}`}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-xs transition-all duration-200 focus-ring border ${
                  pathname === `/chat/${c.id}`
                    ? "bg-white/8 border-white/5 shadow-lg shadow-black/20"
                    : "hover:bg-white/5 border-transparent"
                }`}
              >
                <span
                  className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center overflow-hidden text-sm ring-1 ring-white/5 shadow-md"
                  style={{ backgroundColor: `${c.accentColor}30` }}
                >
                  {c.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveMediaUrl(c.avatarUrl)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    c.avatarEmoji
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-parchment/85 font-medium">{c.name}</span>
                  <span className="block truncate text-parchment/35 leading-tight">{c.lastMessagePreview}</span>
                </span>
              </Link>
            ))}
          </div>
        </nav>

        <div className="p-4 border-t border-white/5 mt-auto relative">
          {!PREMIUM_PAYMENTS_ENABLED && (
            <p className="text-[10px] text-parchment/30 leading-snug mb-3 italic">{EARLY_ACCESS_MESSAGE}</p>
          )}
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-gold/30 to-plum/50 flex items-center justify-center text-xs shadow-md">
              ◉
            </div>
            <p className="text-xs text-parchment/50 truncate" title={displayName}>
              {displayName || "Signed in"}
            </p>
          </div>
        </div>
      </aside>

      <div className={`flex-1 flex flex-col min-w-0 ${variant === "chat" ? "h-screen" : "min-h-screen"}`}>
        {variant !== "chat" && (
          <>
            {/* Mobile top bar */}
            <header className="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/5 bg-gradient-to-r from-surface-raised to-plum-deep/60">
          <Link href="/explore" className="font-display text-lg flex items-center gap-2">
            <Logo size={24} />
            <span className="shimmer-text">Rolichat</span>
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((s) => !s)}
            className="text-parchment/70 hover:text-parchment focus-ring rounded-lg px-2 py-1 transition-colors"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileMenuOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="4" y1="6" x2="20" y2="6" />
                  <line x1="4" y1="12" x2="20" y2="12" />
                  <line x1="4" y1="18" x2="20" y2="18" />
                </>
              )}
            </svg>
          </button>
        </header>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <nav className="md:hidden border-b border-white/5 bg-surface-raised/95 backdrop-blur-sm px-4 py-3 animate-fade-in">
            <div className="space-y-1 mb-4">
              {NAV.map(({ href, label, icon, badge }) => {
                const active = pathname === href || (href === "/dashboard" && pathname?.startsWith("/characters"));
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 focus-ring ${
                      active
                        ? "bg-gradient-to-r from-gold/15 to-gold/5 text-parchment font-medium border border-gold/10"
                        : "text-parchment/55 hover:text-parchment hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <span className={`w-5 text-center text-base ${active ? "text-gold" : "opacity-80"}`}>{icon}</span>
                    <span className="flex-1">{label}</span>
                    {badge && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gold/25 text-gold border border-gold/30">
                        {badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="pt-3 border-t border-white/5">
              <p className="text-[11px] font-medium text-parchment/30 uppercase tracking-widest mb-2">Recent chats</p>
              {chats.length === 0 && (
                <p className="px-3 py-2 text-xs text-parchment/30 text-center italic">No chats yet</p>
              )}
              <div className="space-y-1 max-h-[200px] overflow-y-auto scrollbar-thin">
                {chats.map((c) => (
                  <Link
                    key={c.id}
                    href={`/chat/${c.id}`}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all duration-200 focus-ring border ${
                      pathname === `/chat/${c.id}`
                        ? "bg-white/8 border-white/5"
                        : "hover:bg-white/5 border-transparent"
                    }`}
                  >
                    <span
                      className="w-7 h-7 shrink-0 rounded-full flex items-center justify-center overflow-hidden text-xs ring-1 ring-white/5"
                      style={{ backgroundColor: `${c.accentColor}30` }}
                    >
                      {c.avatarUrl ? (
                        <img src={resolveMediaUrl(c.avatarUrl)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        c.avatarEmoji
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-parchment/85 font-medium">{c.name}</span>
                      <span className="block truncate text-parchment/35 leading-tight">{c.lastMessagePreview}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </nav>
        )}
      </>
        )}
        {children}
      </div>
    </div>
  );
}