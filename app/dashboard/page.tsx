"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import ConfirmDialog from "@/components/ConfirmDialog";
import CharacterImportPanel from "@/components/CharacterImportPanel";
import { CharacterCardSkeleton } from "@/components/Skeleton";

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
  isPublic?: boolean;
};

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

const EMOJI_CHOICES = ["🌸", "🦊", "🌙", "⚔️", "🕯️", "🐉", "☕", "🌊"];
const MAX_FIELD_LENGTH = 1200;

function slugifyAvatar(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/assets/characters/${slug}.png`;
}

const STARTER_TEMPLATES = [
  {
    name: "Wren",
    tagline: "a lighthouse keeper who talks to storms",
    personality: "dry humor, fiercely loyal, terrible at small talk",
    backstory:
      "Wren has kept a remote coastal lighthouse for a decade, mostly alone. They've grown used to talking " +
      "out loud to the weather, and it shows — blunt, a little superstitious, but quick to warm up to anyone " +
      "who sticks around long enough to hear the stories.",
    greeting: "Storm's rolling in tonight. You picked a good evening to knock on my door — come in, mind the puddle.",
    avatarEmoji: "🕯️",
    accentColor: "#c9a227",
  },
  {
    name: "Rook",
    tagline: "a retired thief turned locksmith",
    personality: "sharp wit, guarded, secretly generous",
    backstory:
      "Rook spent years working jobs they'd rather not discuss, then walked away from it all to open a small " +
      "locksmith shop. Old habits die hard — they still case every room out of reflex — but these days the only " +
      "things they're breaking into are stuck drawers and rusted padlocks.",
    greeting: "Shop's technically closed, but I'll make an exception. What's got you locked out?",
    avatarEmoji: "🗝️",
    accentColor: "#8a8f9c",
  },
  {
    name: "Sable",
    tagline: "a dragon who collects stories instead of gold",
    personality: "theatrical, curious, ancient but easily delighted",
    backstory:
      "Sable gave up hoarding treasure centuries ago — turns out stories are lighter to carry and far more " +
      "interesting. They've heard nearly everything, but that's never once stopped them from asking for one more tale.",
    greeting: "Ah, a visitor! Sit, sit — tell me something I haven't heard in three hundred years.",
    avatarEmoji: "🐉",
    accentColor: "#b5657a",
  },
];

export default function DashboardPage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [displayName, setDisplayName] = useState("");

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [personality, setPersonality] = useState("");
  const [backstory, setBackstory] = useState("");
  const [greeting, setGreeting] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🌸");
  const [isExplicit, setIsExplicit] = useState(false);
  const [roleplayNotes, setRoleplayNotes] = useState("");
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [scenePromptTemplate, setScenePromptTemplate] = useState("");
  const [examples, setExamples] = useState("[]");
  const [tags, setTags] = useState("[]");
  const [draftExplicit, setDraftExplicit] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [idea, setIdea] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => setDisplayName(d.user?.displayName ?? ""));
    loadCharacters();
  }, []);

  async function loadCharacters() {
    try {
      const res = await apiFetch("/api/characters");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCharacters(data.characters ?? []);
      } else {
        setError(data.error || "Couldn't load characters.");
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
    }
  }

  async function onUseTemplate(template: (typeof STARTER_TEMPLATES)[number]) {
    if (creatingTemplate) return;
    setCreatingTemplate(template.name);
    try {
      const res = await apiFetch("/api/characters", {
        method: "POST",
        body: JSON.stringify(template),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.character?.id) {
        router.push(`/chat/${data.character.id}`);
      } else {
        setError(data.error || "Couldn't create that character.");
        setCreatingTemplate(null);
      }
    } catch {
      setError("Couldn't reach the server. Please try again.");
      setCreatingTemplate(null);
    }
  }

  async function onDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!idea.trim() || drafting) return;
    setDraftError("");
    setDrafting(true);
    try {
      const res = await apiFetch("/api/characters/draft", {
        method: "POST",
        body: JSON.stringify({ idea: idea.trim(), allowExplicit: draftExplicit }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.draft) {
        setDraftError(data.error || "Couldn't draft a character right now.");
        return;
      }
      setName(data.draft.name);
      setTagline(data.draft.tagline);
      setPersonality(data.draft.personality);
      setBackstory(data.draft.backstory);
      setGreeting(data.draft.greeting);
      if (typeof data.draft.roleplayNotes === "string") setRoleplayNotes(data.draft.roleplayNotes);
      setIsExplicit(draftExplicit);
      setShowForm(true);
      setIdea("");
      requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setDraftError("Couldn't reach the server. Please try again.");
    } finally {
      setDrafting(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    const res = await apiFetch("/api/characters", {
      method: "POST",
      body: JSON.stringify({
        name,
        tagline,
        personality,
        backstory,
        greeting,
        avatarEmoji,
        isExplicit,
        roleplayNotes: isExplicit ? roleplayNotes : "",
        avatarPrompt,
        scenePromptTemplate,
        examples,
        tags,
      }),
    });
    setSaving(false);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Couldn't create that character.");
      return;
    }
    setName("");
    setTagline("");
    setPersonality("");
    setBackstory("");
    setGreeting("");
    setAvatarEmoji("🌸");
    setIsExplicit(false);
    setRoleplayNotes("");
    setAvatarPrompt("");
    setScenePromptTemplate("");
    setExamples("[]");
    setTags("[]");
    setShowForm(false);
    if (data.character?.id) {
      router.push(`/characters/${data.character.id}/edit`);
    } else {
      loadCharacters();
    }
  }

  async function onDelete(id: string) {
    setPendingDeleteId(id);
  }

  async function confirmDelete() {
    if (!pendingDeleteId) return;
    setDeleting(true);
    try {
      await apiFetch(`/api/characters/${pendingDeleteId}`, { method: "DELETE" });
      await loadCharacters();
    } finally {
      setDeleting(false);
      setPendingDeleteId(null);
    }
  }

  return (
    <RequireAuth>
    <AppShell>
    <main className="flex-1 overflow-y-auto px-4 md:px-10 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 mb-10">
        <div>
          <p className="text-xs text-parchment/50 uppercase tracking-widest mb-1">Studio</p>
          <h1 className="font-display text-3xl gradient-text">Your characters</h1>
          <p className="text-sm text-parchment/45 mt-1">Welcome back{displayName ? `, ${displayName}` : ""}</p>
        </div>
        <div className="flex gap-3">
          <Link
            href="/explore"
            className="border border-white/15 px-4 py-2 rounded-full hover:border-gold focus-ring flex items-center text-sm transition-all hover:bg-white/5"
          >
            Explore
          </Link>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="bg-gold text-ink px-5 py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine shadow-lg shadow-gold/15"
          >
            {showForm ? "Cancel" : "+ New character"}
          </button>
        </div>
      </header>

      <div className="gradient-border rounded-2xl bg-gradient-to-br from-gold/10 to-plum/60 p-6 mb-8 max-w-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]">
          <div className="w-full h-full rounded-full bg-gold" style={{ filter: "blur(40px)" }} />
        </div>
        <div className="relative z-10">
          <p className="font-display text-lg mb-1">✨ Quick start</p>
          <p className="text-sm text-parchment/60 mb-4">
            Describe a character idea in one sentence — we'll draft their personality, backstory, and greeting for you
            to review and tweak.
          </p>
          <form onSubmit={onDraft} className="flex flex-col sm:flex-row gap-2">
            <input
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. a grumpy retired sea captain who runs a bookshop now"
              className="flex-1 rounded-xl bg-plum-deep/80 border border-parchment/15 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
              maxLength={300}
            />
            <button
              type="submit"
              disabled={drafting || !idea.trim()}
              className="bg-gold text-ink px-5 py-2.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-50 shrink-0 btn-shine"
            >
              {drafting ? "Drafting…" : "Draft it"}
            </button>
          </form>
          <label className="mt-3 flex items-center gap-2 text-sm text-parchment/60 cursor-pointer group">
            <input
              type="checkbox"
              checked={draftExplicit}
              onChange={(e) => setDraftExplicit(e.target.checked)}
              className="w-4 h-4 rounded accent-rose cursor-pointer"
            />
            <span className="group-hover:text-parchment/80 transition-colors">Draft as explicit/NSFW character</span>
          </label>
          {draftError && <p className="mt-3 text-sm text-rose">{draftError}</p>}
        </div>
      </div>

      <CharacterImportPanel onImported={loadCharacters} />

      {showForm && (
        <form ref={formRef} onSubmit={onCreate} className="gradient-border rounded-2xl bg-gradient-to-br from-plum/60 to-plum-deep/80 p-8 mb-10 max-w-2xl">
          <h2 className="font-display text-xl mb-1 gradient-text">Craft a new character</h2>
          <p className="text-xs text-parchment/50 mb-4">
            Pick an emoji for now — you'll be able to upload or AI-generate a portrait right after creating.
          </p>
          {error && (
            <p className="mb-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 mb-4">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`text-2xl rounded-xl p-2.5 focus-ring transition-all ${
                  avatarEmoji === emoji ? "bg-gold/20 ring-1 ring-gold shadow-lg shadow-gold/10" : "hover:bg-parchment/5"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>

          <label className="block text-sm mb-1.5 text-parchment/60">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mb-4 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
            placeholder="e.g. Wren"
          />

          <label className="block text-sm mb-1.5 text-parchment/60">Tagline</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full mb-4 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
            placeholder="e.g. a lighthouse keeper who talks to storms"
          />

          <label className="block text-sm mb-1.5 text-parchment/60">Personality traits</label>
          <textarea
            required
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            rows={2}
            maxLength={MAX_FIELD_LENGTH}
            className="w-full rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
            placeholder="e.g. dry humor, fiercely loyal, terrible at small talk"
          />
          <p className="text-right text-xs text-parchment/40 mb-4">{personality.length}/{MAX_FIELD_LENGTH}</p>

          <label className="block text-sm mb-1.5 text-parchment/60">Backstory</label>
          <textarea
            required
            value={backstory}
            onChange={(e) => setBackstory(e.target.value)}
            rows={4}
            maxLength={MAX_FIELD_LENGTH}
            className="w-full rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
            placeholder="What's their history? What do they want? What do they avoid talking about?"
          />
          <p className="text-right text-xs text-parchment/40 mb-4">{backstory.length}/{MAX_FIELD_LENGTH}</p>

          <label className="block text-sm mb-1.5 text-parchment/60">Opening greeting</label>
          <textarea
            required
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            className="w-full mb-4 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
            placeholder="The first line they say when a chat opens"
          />

          <label className="flex items-center gap-2 mb-4 text-sm text-parchment/60 cursor-pointer group">
            <input
              type="checkbox"
              checked={isExplicit}
              onChange={(e) => {
                setIsExplicit(e.target.checked);
                if (!e.target.checked) setRoleplayNotes("");
              }}
              className="w-4 h-4 rounded accent-rose cursor-pointer"
            />
            <span className="group-hover:text-parchment/80 transition-colors">Mark as explicit/NSFW character (enables mature avatar generation styling)</span>
          </label>

          {isExplicit && (
            <>
              <label className="block text-sm mb-1.5 text-parchment/60">Roleplay notes (optional)</label>
              <textarea
                value={roleplayNotes}
                onChange={(e) => setRoleplayNotes(e.target.value.slice(0, MAX_FIELD_LENGTH))}
                rows={3}
                className="w-full mb-2 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring text-sm placeholder:text-parchment/25"
                placeholder="Scenario hooks, seduction style, soft boundaries — injected into spicy chats only."
              />
              <p className="text-xs text-parchment/40 mb-6">Private to your account. Used when explicit mode is on in chat.</p>
            </>
          )}

          {!isExplicit && <div className="mb-6" />}

          <label className="block text-sm mb-1.5 text-parchment/60">Appearance description (optional)</label>
          <textarea
            value={avatarPrompt}
            onChange={(e) => setAvatarPrompt(e.target.value.slice(0, MAX_FIELD_LENGTH))}
            rows={3}
            className="w-full mb-2 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring text-sm placeholder:text-parchment/25"
            placeholder="e.g. mid-20s woman, sharp jawline, silver bob haircut, emerald eyes, worn leather jacket..."
          />
          <p className="text-xs text-parchment/40 mb-4">
            Used as the primary prompt for their avatar, background, and every in-chat scene image, so they stay
            visually consistent. Leave blank to fall back to personality/tagline.
          </p>

          <label className="block text-sm mb-1.5 text-parchment/60">Art style / setting (optional)</label>
          <textarea
            value={scenePromptTemplate}
            onChange={(e) => setScenePromptTemplate(e.target.value.slice(0, MAX_FIELD_LENGTH))}
            rows={2}
            className="w-full mb-2 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring text-sm placeholder:text-parchment/25"
            placeholder="e.g. moody film noir lighting, rain-slicked city streets, muted color palette..."
          />

          <label className="block text-sm mb-1.5 text-parchment/60">Example dialogues (optional)</label>
          <p className="text-xs text-parchment/40 mb-2">
            Teach the character how they speak — up to 10 example conversation turns.
          </p>
          <textarea
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            rows={6}
            className="w-full mb-2 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring text-sm font-mono placeholder:text-parchment/25"
            placeholder={`[` +
              `\n  { "user": "Hi there!", "character": "Hey! *waves energetically*" },` +
              `\n  { "user": "How are you?", "character": "Living the dream, one coffee at a time." }` +
              `\n]`
            }
          />

          <label className="block text-sm mb-1.5 text-parchment/60">Tags (optional, comma-separated)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full mb-6 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring text-sm placeholder:text-parchment/25"
            placeholder="e.g. fantasy, romance, adventure, comedy"
          />

          <button
            type="submit"
            disabled={saving}
            className="bg-gold text-ink px-6 py-2.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-60 btn-shine shadow-lg shadow-gold/20"
          >
            {saving ? "Creating…" : "Create character"}
          </button>
        </form>
      )}

      {characters === null && (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <CharacterCardSkeleton key={i} />
          ))}
        </div>
      )}

      {characters !== null && characters.length === 0 && !showForm && (
        <div className="max-w-2xl">
          <div className="gradient-border rounded-2xl bg-gradient-to-br from-plum/60 to-plum-deep/80 p-8 mb-6 text-center">
            <span className="text-4xl block mb-3 opacity-70">🎭</span>
            <p className="font-display text-xl mb-2">No characters yet</p>
            <p className="text-sm text-parchment/60 mb-6">
              Create your own, or jump straight into a chat with one of these.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="bg-gold text-ink px-5 py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine"
            >
              + New character
            </button>
          </div>

          <p className="text-sm text-parchment/50 mb-3 font-display">Or try one of these</p>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            {STARTER_TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => onUseTemplate(t)}
                disabled={creatingTemplate !== null}
                className="gradient-border rounded-2xl bg-gradient-to-br from-plum/60 to-plum-deep/80 p-5 text-left hover:border-gold/40 focus-ring disabled:opacity-50 transition-all card-hover"
              >
                <span
                  className="text-2xl w-11 h-11 flex items-center justify-center rounded-full mb-3 shadow-lg"
                  style={{ backgroundColor: `${t.accentColor}30` }}
                >
                  {t.avatarEmoji}
                </span>
                <p className="font-display text-lg">{t.name}</p>
                <p className="text-xs text-parchment/60 mb-2">{t.tagline}</p>
                <p className="text-xs text-gold font-medium">
                  {creatingTemplate === t.name ? "Starting chat…" : "Start chatting →"}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {characters?.map((c) => {
          const preview = c.lastMessagePreview?.trim();
          const when = relativeTime(c.lastActivityAt);
          return (
            <div key={c.id} className="gradient-border rounded-2xl bg-gradient-to-br from-plum/60 to-plum-deep/80 p-6 flex flex-col card-hover">
              <div className="flex items-center gap-3 mb-3">
                <span
                  className="relative text-2xl w-12 h-12 flex items-center justify-center rounded-full overflow-hidden shrink-0 shadow-lg ring-1 ring-white/5"
                  style={{ backgroundColor: `${c.accentColor}30` }}
                >
                  <span className="text-2xl">{c.avatarEmoji}</span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.avatarUrl ? resolveMediaUrl(c.avatarUrl) : slugifyAvatar(c.name)}
                    alt={c.name}
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-display text-lg truncate">{c.name}</p>
                    {when && <p className="text-[11px] text-parchment/40 shrink-0">{when}</p>}
                  </div>
                  {c.isPublic && (
                    <span className="inline-block text-[10px] text-gold/80 border border-gold/30 rounded-full px-2 py-0.5 mt-0.5">
                      Shared
                    </span>
                  )}
                  {c.tagline && <p className="text-xs text-parchment/60 truncate">{c.tagline}</p>}
                </div>
              </div>
              {preview && (
                <p className="text-xs text-parchment/50 line-clamp-2 mb-2 leading-relaxed">
                  {c.lastMessageRole === "user" ? "You: " : ""}
                  {preview}
                </p>
              )}
              <div className="mt-auto flex gap-2 pt-4 border-t border-white/5">
                <Link
                  href={`/chat/${c.id}`}
                  className="flex-1 text-center bg-gold text-ink py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine text-sm"
                >
                  Chat
                </Link>
                <Link
                  href={`/characters/${c.id}/edit`}
                  className="px-3 rounded-full border border-parchment/20 hover:border-gold focus-ring flex items-center transition-all hover:bg-white/5"
                  aria-label={`Edit ${c.name}`}
                >
                  ✎
                </Link>
                <button
                  onClick={() => onDelete(c.id)}
                  className="px-3 rounded-full border border-parchment/20 hover:border-rose hover:text-rose focus-ring transition-all hover:bg-rose/5"
                  aria-label={`Delete ${c.name}`}
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title={`Delete ${characters?.find((c) => c.id === pendingDeleteId)?.name ?? "this character"}?`}
        description="This deletes the character and its whole conversation history. This can't be undone."
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </main>
    </AppShell>
    </RequireAuth>
  );
}