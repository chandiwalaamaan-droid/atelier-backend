"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";

type Character = {
  id: string;
  name: string;
  tagline: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  accentColor: string;
  lastMessagePreview?: string | null;
  lastMessageRole?: "user" | "assistant" | null;
  lastActivityAt?: string;
};

function slugifyAvatar(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/assets/characters/${slug}.png`;
}

function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function ChatHistoryPage() {
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<"selected" | "all" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    refresh();
  }, []);

  function refresh() {
    setCharacters(null);
    apiFetch("/api/characters")
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((d) => setCharacters(d.characters ?? []));
  }

  // Only chats that actually have history are worth showing here — a
  // freshly created character with no messages has nothing to delete.
  const chats = useMemo(
    () => (characters ?? []).filter((c) => !!c.lastMessagePreview),
    [characters]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelected((prev) => (prev.size === chats.length ? new Set() : new Set(chats.map((c) => c.id))));
  }

  async function runDelete(target: "selected" | "all") {
    setDeleting(true);
    setErrorMsg(null);
    try {
      const body = target === "all" ? { all: true } : { characterIds: Array.from(selected) };
      const res = await apiFetch("/api/chat/bulk-delete", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete chat history.");
      }
      setSelected(new Set());
      setSelectMode(false);
      refresh();
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setDeleting(false);
      setConfirmTarget(null);
    }
  }

  return (
    <RequireAuth>
      <AppShell>
        <div className="flex-1 overflow-y-auto px-4 md:px-10 py-8 pb-28 max-w-3xl mx-auto w-full">
          <div className="flex items-center justify-between mb-1">
            <h1 className="font-display text-xl gradient-text">Chat history</h1>
            {chats.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSelectMode((v) => !v);
                  setSelected(new Set());
                }}
                className="text-xs text-parchment/60 hover:text-gold border border-white/10 hover:border-gold/30 px-3 py-1.5 rounded-full focus-ring transition-colors"
              >
                {selectMode ? "Cancel" : "Select"}
              </button>
            )}
          </div>
          <p className="text-xs text-parchment/40 mb-6">
            Delete previous conversations one at a time, select a few, or clear everything at once. This only
            removes messages and memory — your characters stay intact.
          </p>

          {errorMsg && (
            <div className="mb-4 p-3 rounded-xl bg-rose/10 border border-rose/20 text-xs text-rose/90">
              {errorMsg}
            </div>
          )}

          {characters === null && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl bg-surface-card border border-white/5 animate-pulse shimmer" />
              ))}
            </div>
          )}

          {characters !== null && chats.length === 0 && (
            <div className="text-center py-16 text-parchment/45">
              <span className="text-4xl block mb-3 opacity-50">💬</span>
              <p className="font-display text-lg mb-1">No chat history yet</p>
              <p className="text-sm text-parchment/40">Conversations you've had will show up here.</p>
            </div>
          )}

          {chats.length > 0 && (
            <>
              {selectMode && (
                <div className="flex items-center justify-between mb-3 text-xs">
                  <button
                    type="button"
                    onClick={toggleAllSelected}
                    className="text-parchment/60 hover:text-gold transition-colors"
                  >
                    {selected.size === chats.length ? "Deselect all" : "Select all"}
                  </button>
                  <span className="text-parchment/40">{selected.size} selected</span>
                </div>
              )}

              <ul className="space-y-3">
                {chats.map((c) => (
                  <li key={c.id}>
                    <div
                      className={`flex items-center gap-3 p-3 rounded-xl bg-gradient-to-r from-surface-card to-surface-raised border transition-all ${
                        selectMode && selected.has(c.id) ? "border-gold/40" : "border-white/5"
                      }`}
                    >
                      {selectMode && (
                        <button
                          type="button"
                          onClick={() => toggle(c.id)}
                          aria-pressed={selected.has(c.id)}
                          aria-label={selected.has(c.id) ? `Deselect chat with ${c.name}` : `Select chat with ${c.name}`}
                          className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center focus-ring ${
                            selected.has(c.id) ? "bg-gold border-gold text-ink" : "border-white/25"
                          }`}
                        >
                          {selected.has(c.id) && <span className="text-[11px] leading-none">✓</span>}
                        </button>
                      )}

                      {selectMode ? (
                        <button
                          type="button"
                          onClick={() => toggle(c.id)}
                          className="flex items-center gap-3 min-w-0 flex-1 text-left focus-ring rounded-lg"
                        >
                          <ChatAvatar c={c} />
                          <ChatMeta c={c} />
                        </button>
                      ) : (
                        <Link href={`/chat/${c.id}`} className="flex items-center gap-3 min-w-0 flex-1 focus-ring rounded-lg">
                          <ChatAvatar c={c} />
                          <ChatMeta c={c} />
                        </Link>
                      )}

                      {!selectMode && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(new Set([c.id]));
                            setConfirmTarget("selected");
                          }}
                          className="shrink-0 text-xs text-rose/70 hover:text-rose border border-rose/20 hover:border-rose/40 px-3 py-1.5 rounded-full focus-ring transition-colors"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>

              <div className="mt-8 border-t border-rose/10 pt-6 flex flex-wrap items-center gap-3">
                {selectMode && (
                  <button
                    type="button"
                    disabled={selected.size === 0}
                    onClick={() => setConfirmTarget("selected")}
                    className="text-xs bg-rose text-ink px-4 py-1.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Delete selected ({selected.size})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirmTarget("all")}
                  className="text-xs text-rose/80 hover:text-rose border border-rose/20 hover:border-rose/40 px-4 py-1.5 rounded-full focus-ring transition-colors"
                >
                  Delete all chat history
                </button>
              </div>
            </>
          )}
        </div>
      </AppShell>

      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmTarget === "all" ? "Delete all chat history?" : `Delete ${selected.size} chat${selected.size === 1 ? "" : "s"}?`}
        description={
          confirmTarget === "all"
            ? "This permanently clears every conversation across all your characters. Your characters themselves won't be deleted. This can't be undone."
            : "This permanently clears the selected conversation(s) and their memory. This can't be undone."
        }
        confirmLabel={deleting ? "Deleting…" : "Yes, delete"}
        cancelLabel="Cancel"
        destructive
        onConfirm={() => confirmTarget && runDelete(confirmTarget)}
        onCancel={() => !deleting && setConfirmTarget(null)}
      />
    </RequireAuth>
  );
}

function ChatAvatar({ c }: { c: Character }) {
  return (
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
        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
      />
    </span>
  );
}

function ChatMeta({ c }: { c: Character }) {
  const time = relativeTime(c.lastActivityAt);
  return (
    <span className="min-w-0 flex-1">
      <span className="flex items-center gap-2">
        <span className="block font-medium truncate">{c.name}</span>
        {time && <span className="shrink-0 text-[10px] text-parchment/35">{time}</span>}
      </span>
      <span className="block text-xs text-parchment/45 truncate">
        {c.lastMessageRole === "user" ? "You: " : ""}
        {c.lastMessagePreview}
      </span>
    </span>
  );
}
