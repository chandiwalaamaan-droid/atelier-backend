"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

type MemoryPanelProps = {
  open: boolean;
  characterId: string;
  characterName: string;
  onClose: () => void;
};

/** Surfaces the character's running memory summary — normally an invisible
 * backend detail — as something the user can read, correct, or erase, so
 * "the AI remembers things about you" becomes a feature you can trust
 * instead of a black box. */
export default function MemoryPanel({ open, characterId, characterName, onClose }: MemoryPanelProps) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState("");
  const [totalMessages, setTotalMessages] = useState(0);
  const [summarizedThrough, setSummarizedThrough] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmForgetOpen, setConfirmForgetOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    apiFetch(`/api/chat/${characterId}/memory`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject(await r.json().catch(() => ({})))))
      .then((data) => {
        setSummary(data.memorySummary ?? "");
        setSummarizedThrough(data.summarizedThrough ?? 0);
        setTotalMessages(data.totalMessages ?? 0);
      })
      .catch(() => setError("Couldn't load memory."))
      .finally(() => setLoading(false));
  }, [open, characterId]);

  async function onSave() {
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/chat/${characterId}/memory`, {
        method: "PUT",
        body: JSON.stringify({ memorySummary: summary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't save changes.");
        return;
      }
      setSummary(data.memorySummary ?? summary);
      onClose();
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  async function onForget() {
    setConfirmForgetOpen(false);
    setSaving(true);
    setError("");
    try {
      const res = await apiFetch(`/api/chat/${characterId}/memory`, {
        method: "PUT",
        body: JSON.stringify({ forget: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Couldn't forget memory.");
        return;
      }
      setSummary("");
      setSummarizedThrough(data.summarizedThrough ?? totalMessages);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 px-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-panel w-full max-w-lg rounded-2xl p-6 shadow-2xl max-h-[80vh] flex flex-col message-slide-in"
      >
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧠</span>
            <p className="font-display text-lg gradient-text">What {characterName} remembers</p>
          </div>
          <button onClick={onClose} className="text-parchment/50 hover:text-gold focus-ring rounded px-1 text-lg" aria-label="Close memory panel">
            ✕
          </button>
        </div>
        <p className="text-xs text-parchment/40 mb-4">
          {summarizedThrough > 0
            ? `A running summary of your first ${summarizedThrough} of ${totalMessages} messages. Recent messages stay in context on their own and aren't included here.`
            : "Nothing has been folded into long-term memory yet — recent messages are still in context on their own."}
        </p>

        {error && <p className="mb-3 text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">{error}</p>}

        {loading ? (
          <div className="space-y-2 flex-1">
            <div className="skeleton-text w-full" />
            <div className="skeleton-text w-5/6" />
            <div className="skeleton-text w-2/3" />
            <div className="skeleton-text w-4/5" />
          </div>
        ) : (
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={10}
            maxLength={4000}
            placeholder="Nothing remembered yet."
            className="flex-1 min-h-[160px] w-full rounded-lg bg-plum/60 border border-parchment/20 px-3 py-2 text-sm resize-none focus-ring"
          />
        )}

        <div className="flex items-center justify-between mt-4">
          <button
            onClick={() => setConfirmForgetOpen(true)}
            disabled={loading || saving || (!summary && summarizedThrough === 0)}
            className="text-sm text-rose/80 hover:text-rose focus-ring rounded px-2 py-1 disabled:opacity-30 transition-colors"
          >
            🗑 Forget everything
          </button>
          <div className="flex gap-3">
            <button onClick={onClose} className="text-sm px-4 py-2 rounded-full border border-parchment/20 hover:border-gold/50 focus-ring transition-all hover:bg-white/5">
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={loading || saving}
              className="text-sm bg-gold text-ink px-4 py-2 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-50 btn-shine shadow-lg shadow-gold/15"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmForgetOpen}
        title={`Forget everything ${characterName} remembers?`}
        description="This clears the long-term memory summary. Recent messages in this conversation are unaffected."
        confirmLabel="Forget"
        destructive
        onConfirm={onForget}
        onCancel={() => setConfirmForgetOpen(false)}
      />
    </div>
  );
}
