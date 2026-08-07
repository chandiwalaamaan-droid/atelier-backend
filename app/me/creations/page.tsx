"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";

type Character = {
  id: string;
  name: string;
  tagline: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  accentColor: string;
  isPublic?: boolean;
  examples?: string;
  tags?: string;
};

function slugifyAvatar(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/assets/characters/${slug}.png`;
}

export default function MyCreationsPage() {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [tab, setTab] = useState<"creations" | "collect" | "gallery">("creations");

  useEffect(() => {
    apiFetch("/api/characters")
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((d) => setCharacters(d.characters ?? []));
  }, []);

  return (
    <RequireAuth>
      <AppShell>
        <div className="flex-1 overflow-y-auto px-4 md:px-10 py-8 pb-28 max-w-3xl mx-auto w-full">
          <h1 className="font-display text-xl gradient-text mb-6">My Creations</h1>

          <div className="flex flex-wrap gap-3 sm:gap-6 border-b border-white/10 mb-6 text-sm">
            {(
              [
                ["creations", "Creations"],
                ["collect", "Collect 🔒"],
                ["gallery", "Gallery 🔒"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`pb-3 border-b-2 -mb-px focus-ring transition-colors ${
                  tab === id ? "border-gold text-parchment" : "border-transparent text-parchment/45 hover:text-parchment/70"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "creations" && (
            <>
              {characters === null && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-xl bg-surface-card border border-white/5 animate-pulse shimmer" />
                  ))}
                </div>
              )}
              {characters?.length === 0 && (
                <div className="text-center py-16 text-parchment/45">
                  <span className="text-4xl block mb-3 opacity-50">🎭</span>
                  <p className="font-display text-lg mb-1">No characters yet</p>
                  <p className="text-sm text-parchment/40">Create your first character in Studio.</p>
                </div>
              )}
              <ul className="space-y-3">
                {characters?.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/chat/${c.id}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-surface-card to-surface-raised border border-white/5 hover:border-gold/20 focus-ring transition-all card-hover"
                    >
                      <span
                        className="relative w-12 h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-white/5"
                        style={{ backgroundColor: `${c.accentColor}35` }}
                      >
                        <span className="text-xl">{c.avatarEmoji}</span>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={c.avatarUrl ? resolveMediaUrl(c.avatarUrl) : slugifyAvatar(c.name)}
                          alt={c.name}
                          className="absolute inset-0 w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium truncate">{c.name}</span>
                        <span className="block text-xs text-parchment/45 truncate">{c.tagline}</span>
                      </span>
                      {c.isPublic && (
                        <span className="text-[10px] text-gold/60 border border-gold/20 px-2 py-0.5 rounded-full">
                          Public
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
              <Link
                href="/dashboard"
                className="fixed bottom-8 left-1/2 -translate-x-1/2 md:left-auto md:translate-x-0 md:right-12 flex items-center gap-2 bg-gold text-ink px-6 py-3 rounded-full font-medium shadow-lg shadow-gold/20 hover:brightness-110 focus-ring btn-shine"
              >
                + Create
              </Link>
            </>
          )}

          {(tab === "collect" || tab === "gallery") && (
            <div className="text-center py-20 text-parchment/45">
              <span className="text-4xl block mb-3 opacity-50">🔒</span>
              <p className="font-display text-lg mb-2">Premium feature</p>
              <p className="text-sm mb-6 text-parchment/40">Collections and gallery unlock with Rolichat+ later.</p>
              <Link href="/plus" className="text-gold hover:text-gold/80 transition-colors text-sm font-medium">
                View membership →
              </Link>
            </div>
          )}
        </div>
      </AppShell>
    </RequireAuth>
  );
}
