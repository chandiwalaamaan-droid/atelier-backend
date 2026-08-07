"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import WelcomeOnboarding from "@/components/WelcomeOnboarding";
import ExploreCharacterCard, {
  ExploreCharacterCardSkeleton,
  inferTags,
  type ExploreCardCharacter,
} from "@/components/ExploreCharacterCard";
import { PremiumLockBadge } from "@/components/PremiumActionButton";

const REPORT_REASONS: { value: string; label: string }[] = [
  { value: "harassment_or_hate", label: "Harassment or hate speech" },
  { value: "impersonates_real_person", label: "Impersonates a real person" },
  { value: "sexual_content_not_marked_explicit", label: "Sexual content (not marked explicit)" },
  { value: "spam_or_scam", label: "Spam or scam" },
  { value: "other", label: "Something else" },
];

const TABS = [
  { id: "all", label: "Explore" },
  { id: "trending", label: "Trending" },
  { id: "premium", label: "Premium" },
  { id: "romance", label: "Romance" },
  { id: "drama", label: "Drama" },
  { id: "slice", label: "Slice of life" },
  { id: "adventure", label: "Adventure" },
  { id: "comedy", label: "Comedy" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function matchesTab(c: ExploreCardCharacter, tab: TabId): boolean {
  if (tab === "all") return true;
  const tags = inferTags(c).map((t) => t.toLowerCase());
  if (tab === "trending") return true;
  if (tab === "premium") return tags.includes("romance") || tags.includes("drama");
  if (tab === "romance") return tags.includes("romance");
  if (tab === "drama") return tags.includes("drama");
  if (tab === "slice") return tags.includes("slice of life");
  if (tab === "adventure") return tags.includes("adventure");
  if (tab === "comedy") return tags.includes("comedy");
  return true;
}

export default function ExplorePage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<ExploreCardCharacter[] | null>(null);
  const [tab, setTab] = useState<TabId>("all");
  const [query, setQuery] = useState("");
  const [remixingId, setRemixingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [reportTarget, setReportTarget] = useState<ExploreCardCharacter | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0].value);
  const [reportNote, setReportNote] = useState("");
  const [reportStatus, setReportStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [reportError, setReportError] = useState("");
  const [nsfwEnabled, setNsfwEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("rolichat_nsfw") === "1";
  });

  function toggleNsfw() {
    if (!nsfwEnabled) {
      const confirmed = window.confirm(
        "This will show explicit (18+) characters. Continue only if you're an adult and want to see mature content."
      );
      if (!confirmed) return;
    }
    const next = !nsfwEnabled;
    setNsfwEnabled(next);
    window.localStorage.setItem("rolichat_nsfw", next ? "1" : "0");
  }

  useEffect(() => {
    let ignore = false;
    setCharacters(null);
    apiFetch(`/api/characters/discover${nsfwEnabled ? "?nsfw=1" : ""}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        if (!ignore) setCharacters(data.characters);
      })
      .catch(() => {
        if (!ignore) setCharacters([]);
      });
    return () => {
      ignore = true;
    };
  }, [nsfwEnabled]);

  const filtered = useMemo(() => {
    if (!characters) return null;
    const q = query.trim().toLowerCase();
    let list = characters.filter((c) => matchesTab(c, tab));
    if (tab === "trending") {
      list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    }
    if (q) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.tagline.toLowerCase().includes(q) ||
          c.personality.toLowerCase().includes(q) ||
          (() => {
            try {
              const tags = JSON.parse(c.tags || "[]");
              return Array.isArray(tags) && tags.some((t: string) => t.toLowerCase().includes(q));
            } catch {
              return false;
            }
          })()
      );
    }
    return list;
  }, [characters, tab, query]);

  async function onRemix(id: string) {
    if (remixingId) return;
    setError("");
    setRemixingId(id);
    try {
      const res = await apiFetch(`/api/characters/${id}/remix`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.character) {
        setError(data.error || "Couldn't add that character.");
        return;
      }
      router.push(`/chat/${data.character.id}`);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setRemixingId(null);
    }
  }

  async function submitReport() {
    if (!reportTarget) return;
    setReportStatus("sending");
    setReportError("");
    try {
      const res = await apiFetch(`/api/characters/${reportTarget.id}/report`, {
        method: "POST",
        body: JSON.stringify({ reason: reportReason, note: reportNote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReportError(data.error || "Couldn't submit the report.");
        setReportStatus("idle");
        return;
      }
      setReportStatus("sent");
    } catch {
      setReportError("Couldn't reach the server.");
      setReportStatus("idle");
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <WelcomeOnboarding />
        <div className="flex-1 overflow-y-auto">
          <div className="px-4 md:px-8 pt-6 pb-4">
            <Link
              href="/plus"
              className="promo-banner block rounded-2xl border border-gold/20 px-6 py-5 mb-6 overflow-hidden relative focus-ring group"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 relative z-10">
                <div>
                  <p className="text-xs text-gold/90 uppercase tracking-widest mb-1 flex items-center gap-1">
                    <span className="text-gold">♛</span> Join Rolichat+
                  </p>
                  <p className="text-xl md:text-2xl font-display text-parchment">
                    Unlimited access to premium roleplay engines
                  </p>
                  <p className="text-sm text-parchment/50 mt-1 flex items-center gap-2 flex-wrap">
                    Premium models · Extended memory · No ads (later)
                    <PremiumLockBadge />
                  </p>
                </div>
                <span className="text-5xl opacity-80 hidden sm:block group-hover:animate-float" aria-hidden>
                  ♛
                </span>
              </div>
            </Link>

            <div className="flex flex-col lg:flex-row lg:items-center gap-4 mb-4">
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
                {TABS.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setTab(id)}
                    className={`shrink-0 px-4 py-2 rounded-full text-sm focus-ring border transition-all duration-200 ${
                      tab === id
                        ? "bg-gradient-to-r from-gold/20 to-gold/10 border-gold/30 text-parchment shadow-sm"
                        : "border-transparent text-parchment/45 hover:text-parchment/70 hover:bg-white/5"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 max-w-md ml-auto flex items-center gap-2">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-parchment/30 text-sm">⌕</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search characters…"
                    className="w-full rounded-full bg-surface-card border border-white/10 pl-8 pr-4 py-2.5 text-sm focus-ring placeholder:text-parchment/25 transition-all"
                  />
                </div>
                <button
                  type="button"
                  onClick={toggleNsfw}
                  aria-pressed={nsfwEnabled}
                  title={nsfwEnabled ? "Showing 18+ characters — tap to hide" : "Showing SFW only — tap to show 18+ characters"}
                  className={`shrink-0 px-4 py-2.5 rounded-full text-sm font-medium border transition-all duration-200 focus-ring ${
                    nsfwEnabled
                      ? "bg-rose/20 border-rose/40 text-rose shadow-sm shadow-rose/10"
                      : "bg-surface-card border-white/10 text-parchment/50 hover:text-parchment/80"
                  }`}
                >
                  {nsfwEnabled ? "18+ On" : "18+ Off"}
                </button>
              </div>
            </div>

            {error && (
              <p className="mb-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">{error}</p>
            )}

            {filtered === null && (
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {Array.from({ length: 10 }).map((_, i) => (
                  <ExploreCharacterCardSkeleton key={i} />
                ))}
              </div>
            )}

            {filtered?.length === 0 && (
              <div className="text-center py-20 text-parchment/45">
                <span className="text-5xl block mb-4 opacity-50">🔍</span>
                <p className="text-lg mb-2 font-display">Nothing here yet</p>
                <p className="text-sm max-w-md mx-auto text-parchment/40">
                  Share a character from{" "}
                  <Link href="/dashboard" className="text-gold hover:text-gold/80 transition-colors">
                    Studio
                  </Link>{" "}
                  or try another category.
                </p>
              </div>
            )}

            {filtered && filtered.length > 0 && (
              <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filtered.map((c) => (
                  <ExploreCharacterCard
                    key={c.id}
                    character={c}
                    onRemix={() => onRemix(c.id)}
                    remixing={remixingId === c.id}
                    onReport={() => {
                      setReportTarget(c);
                      setReportReason(REPORT_REASONS[0].value);
                      setReportNote("");
                      setReportStatus("idle");
                      setReportError("");
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {reportTarget && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center px-6 z-50 animate-fade-in" onClick={() => setReportTarget(null)}>
            <div className="w-full max-w-sm rounded-2xl bg-surface-card border border-white/10 p-6 shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
              {reportStatus === "sent" ? (
                <>
                  <div className="text-center">
                    <span className="text-3xl block mb-3">✓</span>
                    <h2 className="font-display text-xl mb-2">Report sent</h2>
                    <p className="text-sm text-parchment/50 mb-4">We'll review it as soon as possible.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setReportTarget(null)}
                    className="w-full mt-2 bg-gold text-ink py-2 rounded-full font-medium focus-ring btn-shine"
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <h2 className="font-display text-xl mb-4">Report "{reportTarget.name}"</h2>
                  {reportError && <p className="mb-3 text-sm text-rose">{reportError}</p>}
                  <select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    className="w-full mb-3 rounded-xl bg-surface-raised border border-white/10 px-3 py-2.5 text-sm focus-ring"
                  >
                    {REPORT_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={reportNote}
                    onChange={(e) => setReportNote(e.target.value)}
                    rows={3}
                    className="w-full mb-4 rounded-xl bg-surface-raised border border-white/10 px-3 py-2.5 text-sm focus-ring resize-none placeholder:text-parchment/25"
                    placeholder="Optional details"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setReportTarget(null)} className="flex-1 py-2 rounded-full border border-white/15 focus-ring hover:bg-white/5 transition-colors">
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitReport}
                      disabled={reportStatus === "sending"}
                      className="flex-1 py-2 rounded-full bg-rose text-ink font-medium focus-ring disabled:opacity-50 btn-shine"
                    >
                      {reportStatus === "sending" ? "Sending…" : "Submit"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </AppShell>
    </RequireAuth>
  );
}