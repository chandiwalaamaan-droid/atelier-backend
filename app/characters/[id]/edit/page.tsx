"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
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
  backgroundUrl: string | null;
  accentColor: string;
  personality: string;
  backstory: string;
  greeting: string;
  isExplicit: boolean;
  isPublic: boolean;
  roleplayNotes?: string;
  avatarPrompt?: string;
  scenePromptTemplate?: string;
  examples?: string;
  tags?: string;
};

const EMOJI_CHOICES = ["🌸", "🦊", "🌙", "⚔️", "🕯️", "🐉", "☕", "🌊"];

export default function EditCharacterPage() {
  const { id } = useParams<{ id: string }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);

  const [character, setCharacter] = useState<Character | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [personality, setPersonality] = useState("");
  const [backstory, setBackstory] = useState("");
  const [greeting, setGreeting] = useState("");
  const [avatarEmoji, setAvatarEmoji] = useState("🌸");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isExplicit, setIsExplicit] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [roleplayNotes, setRoleplayNotes] = useState("");
  const [avatarPrompt, setAvatarPrompt] = useState("");
  const [scenePromptTemplate, setScenePromptTemplate] = useState("");
  const [examples, setExamples] = useState("[]");
  const [tags, setTags] = useState("[]");

  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgGenerating, setBgGenerating] = useState(false);
  const [bgPrompt, setBgPrompt] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiFetch(`/api/characters/${id}`)
      .then(async (r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        const c: Character = data.character;
        setCharacter(c);
        setName(c.name);
        setTagline(c.tagline);
        setPersonality(c.personality);
        setBackstory(c.backstory);
        setGreeting(c.greeting);
        setAvatarEmoji(c.avatarEmoji);
        setAvatarUrl(c.avatarUrl);
        setBgUrl(c.backgroundUrl ?? null);
        setIsExplicit(c.isExplicit ?? false);
        setIsPublic(c.isPublic ?? false);
        setRoleplayNotes(c.roleplayNotes ?? "");
        setAvatarPrompt(c.avatarPrompt ?? "");
        setScenePromptTemplate(c.scenePromptTemplate ?? "");
        setExamples(c.examples ?? "[]");
        setTags(c.tags ?? "[]");
      })
      .catch(() => setNotFound(true));
  }, [id]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    setSaved(false);
    const res = await apiFetch(`/api/characters/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        name,
        tagline,
        personality,
        backstory,
        greeting,
        avatarEmoji,
        isExplicit,
        isPublic,
        roleplayNotes: isExplicit ? roleplayNotes : "",
        avatarPrompt,
        scenePromptTemplate,
        examples,
        tags,
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Couldn't save changes.");
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    const form = new FormData();
    form.append("avatar", file);
    const res = await apiFetch(`/api/characters/${id}/avatar`, { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Upload failed.");
      return;
    }
    const data = await res.json();
    setAvatarUrl(data.character.avatarUrl);
  }

  async function onBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setBgUploading(true);
    const form = new FormData();
    form.append("background", file);
    const res = await apiFetch(`/api/characters/${id}/background`, { method: "POST", body: form });
    setBgUploading(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Upload failed.");
      return;
    }
    const data = await res.json();
    setBgUrl(data.character.backgroundUrl);
  }

  async function onGenerate() {
    setError("");
    setGenerating(true);
    const res = await apiFetch(`/api/characters/${id}/avatar/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: imagePrompt.trim() || undefined }),
    });
    setGenerating(false);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Generation failed.");
      return;
    }
    const data = await res.json();
    setAvatarUrl(data.character.avatarUrl);
  }

  if (notFound) {
    return (
      <RequireAuth>
        <AppShell>
          <main className="flex-1 flex items-center justify-center gap-4">
            <p className="font-display text-xl">Couldn&apos;t find that character.</p>
            <Link href="/dashboard" className="text-gold hover:underline">
              Back to Studio
            </Link>
          </main>
        </AppShell>
      </RequireAuth>
    );
  }

  if (!character) {
    return (
      <RequireAuth>
        <AppShell>
          <main className="flex-1 overflow-y-auto px-4 md:px-10 py-8">
            <div className="max-w-2xl mx-auto animate-pulse">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-6 h-6 rounded bg-parchment/10" />
            <div className="h-7 w-40 rounded bg-parchment/10" />
          </div>
          <div className="stitched rounded-2xl bg-plum/60 p-6 mb-6">
            <div className="h-4 w-16 rounded bg-parchment/10 mb-3" />
            <div className="flex items-center gap-5">
              <div className="w-20 h-20 rounded-full bg-parchment/10 shrink-0" />
              <div className="h-8 w-32 rounded-full bg-parchment/10" />
            </div>
          </div>
          <div className="stitched rounded-2xl bg-plum/60 p-6 space-y-4">
            <div className="h-9 w-full rounded-lg bg-parchment/10" />
            <div className="h-9 w-full rounded-lg bg-parchment/10" />
            <div className="h-16 w-full rounded-lg bg-parchment/10" />
            <div className="h-28 w-full rounded-lg bg-parchment/10" />
          </div>
            </div>
          </main>
        </AppShell>
      </RequireAuth>
    );
  }

  return (
    <RequireAuth>
    <AppShell>
    <main className="flex-1 overflow-y-auto px-4 md:px-10 py-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link href="/dashboard" className="text-parchment/60 hover:text-gold focus-ring rounded px-2">
            ←
          </Link>
          <h1 className="font-display text-2xl">Edit {character.name}</h1>
        </div>

        {error && (
          <p className="mb-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">{error}</p>
        )}
        {saved && (
          <p className="mb-4 text-sm text-gold bg-gold/10 border border-gold/30 rounded px-3 py-2">Saved.</p>
        )}

        <div className="stitched rounded-2xl bg-plum/60 p-6 mb-6">
          <p className="text-sm text-parchment/70 mb-3">Avatar</p>
          <div className="flex items-center gap-5">
            <span
              className="w-20 h-20 rounded-full flex items-center justify-center text-3xl overflow-hidden shrink-0"
              style={{ backgroundColor: `${character.accentColor}30` }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveMediaUrl(avatarUrl)} alt={character.name} className="w-full h-full object-cover" />
              ) : (
                avatarEmoji
              )}
            </span>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload image"}
                </button>
                <button
                  type="button"
                  onClick={onGenerate}
                  disabled={generating}
                  className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50"
                >
                  {generating ? "Generating…" : "Generate with AI"}
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={onUpload}
              />
              <p className="text-xs text-parchment/50">PNG, JPEG, WebP, or GIF, up to 5MB.</p>
              <label className="block text-xs text-parchment/60 mt-3 mb-1">
                Custom AI prompt {isExplicit ? "(optional — NSFW allowed)" : "(optional)"}
              </label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                rows={2}
                maxLength={4000}
                placeholder={
                  isExplicit
                    ? "Describe the portrait you want — mature or suggestive styling is fine for explicit characters."
                    : "Override the default portrait prompt, or leave blank to auto-generate from the character profile."
                }
                className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 text-sm focus-ring"
              />
            </div>
          </div>

          <p className="text-sm text-parchment/70 mt-5 mb-2">Or pick an emoji fallback</p>
          <div className="flex gap-2">
            {EMOJI_CHOICES.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => setAvatarEmoji(emoji)}
                className={`text-2xl rounded-lg p-2 focus-ring ${
                  avatarEmoji === emoji ? "bg-gold/20 ring-1 ring-gold" : "hover:bg-parchment/5"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        <div className="stitched rounded-2xl bg-plum/60 p-6 mb-6">
          <p className="text-sm text-parchment/70 mb-3">Chat Background</p>
          <div className="flex items-center gap-5">
            <div
              className="w-20 h-12 rounded-lg overflow-hidden shrink-0 border border-white/10"
              style={{ backgroundColor: `${character.accentColor}20` }}
            >
              {bgUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={resolveMediaUrl(bgUrl)} alt="Background preview" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xs text-parchment/40 flex items-center justify-center h-full">No bg</span>
              )}
            </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => bgFileInputRef.current?.click()}
                    disabled={bgUploading}
                    className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50"
                  >
                    {bgUploading ? "Uploading…" : "Upload"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setError("");
                      setBgGenerating(true);
                      const res = await apiFetch(`/api/characters/${id}/background/generate`, {
                        method: "POST",
                        body: JSON.stringify({ prompt: bgPrompt.trim() || undefined }),
                      });
                      setBgGenerating(false);
                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}));
                        setError(data.error || "Generation failed.");
                        return;
                      }
                      setBgUrl((await res.json()).character.backgroundUrl);
                    }}
                    disabled={bgGenerating}
                    className="text-sm border border-parchment/30 px-4 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50"
                  >
                    {bgGenerating ? "Generating…" : "Generate with AI"}
                  </button>
                  {bgUrl && (
                    <button
                      type="button"
                      onClick={async () => {
                        setError("");
                        const res = await apiFetch(`/api/characters/${id}/background`, { method: "DELETE" });
                        if (!res.ok) {
                          const data = await res.json().catch(() => ({}));
                          setError(data.error || "Delete failed.");
                          return;
                        }
                        setBgUrl(null);
                      }}
                      className="text-sm text-rose/80 hover:text-rose focus-ring"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <input
                  ref={bgFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onBgUpload}
                />
                <p className="text-xs text-parchment/50">PNG, JPEG, WebP, or GIF, up to 5MB.</p>
              <label className="block text-xs text-parchment/60 mt-3 mb-1">
                Custom background prompt
              </label>
              <textarea
                value={bgPrompt}
                onChange={(e) => setBgPrompt(e.target.value)}
                rows={2}
                maxLength={4000}
                className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 text-sm focus-ring"
                placeholder="Override the default prompt, or leave blank to auto-generate from the character profile."
              />
            </div>
          </div>
        </div>

        <form onSubmit={onSave} className="stitched rounded-2xl bg-plum/60 p-6">
          <label className="block text-sm mb-1 text-parchment/70">Name</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
          />

          <label className="block text-sm mb-1 text-parchment/70">Tagline</label>
          <input
            value={tagline}
            onChange={(e) => setTagline(e.target.value)}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
          />

          <label className="block text-sm mb-1 text-parchment/70">Personality traits</label>
          <textarea
            required
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            rows={2}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
          />

          <label className="block text-sm mb-1 text-parchment/70">Backstory</label>
          <textarea
            required
            value={backstory}
            onChange={(e) => setBackstory(e.target.value)}
            rows={4}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
          />

          <label className="block text-sm mb-1 text-parchment/70">Opening greeting</label>
          <textarea
            required
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={2}
            className="w-full mb-6 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
          />

          <div className="flex items-center gap-3 mb-4 pb-6 border-b border-parchment/10">
            <input
              type="checkbox"
              id="isExplicit"
              checked={isExplicit}
              onChange={(e) => {
                setIsExplicit(e.target.checked);
                if (!e.target.checked) setRoleplayNotes("");
              }}
              className="w-4 h-4 rounded cursor-pointer accent-rose"
            />
            <label htmlFor="isExplicit" className="text-sm text-parchment/70 cursor-pointer">
              Mark as explicit/NSFW character
            </label>
          </div>

          <div className="flex items-center gap-3 mb-6 pb-6 border-b border-parchment/10">
            <input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="w-4 h-4 rounded cursor-pointer accent-gold"
            />
            <label htmlFor="isPublic" className="text-sm text-parchment/70 cursor-pointer">
              Share to the Discover gallery so others can remix this character
            </label>
          </div>
          {isExplicit && isPublic && (
            <p className="text-xs text-parchment/40 -mt-4 mb-4">
              Only visible to people who've turned on 18+ content in Discover.
            </p>
          )}

          {isExplicit && (
            <>
              <label className="block text-sm mb-1 text-parchment/70">Roleplay notes (optional)</label>
              <textarea
                value={roleplayNotes}
                onChange={(e) => setRoleplayNotes(e.target.value.slice(0, 1200))}
                rows={3}
                className="w-full mb-6 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
                placeholder="Kinks, scenario hooks, tone, boundaries — shapes explicit-mode replies."
              />
            </>
          )}

          <label className="block text-sm mb-1 text-parchment/70">Appearance description (optional)</label>
          <p className="text-xs text-parchment/40 mb-2">
            Exactly what this character looks like — used as the primary prompt for their avatar, background, and
            every in-chat scene image, so they stay visually consistent. Leave blank to fall back to personality/tagline.
          </p>
          <textarea
            value={avatarPrompt}
            onChange={(e) => setAvatarPrompt(e.target.value.slice(0, 2000))}
            rows={3}
            className="w-full mb-6 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
            placeholder="e.g. mid-20s woman, sharp jawline, silver bob haircut, emerald eyes, wears a worn leather jacket..."
          />

          <label className="block text-sm mb-1 text-parchment/70">Art style / setting (optional)</label>
          <p className="text-xs text-parchment/40 mb-2">
            Reused across every generated scene with this character so the visual style stays consistent from one
            image to the next.
          </p>
          <textarea
            value={scenePromptTemplate}
            onChange={(e) => setScenePromptTemplate(e.target.value.slice(0, 2000))}
            rows={2}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
            placeholder="e.g. moody film noir lighting, rain-slicked city streets, muted color palette..."
          />

          <label className="block text-sm mb-1 text-parchment/70">Example dialogues (optional)</label>
          <p className="text-xs text-parchment/40 mb-2">
            Teach the character how they speak — up to 10 example conversation turns as JSON.
          </p>
          <textarea
            value={examples}
            onChange={(e) => setExamples(e.target.value)}
            rows={8}
            className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm font-mono"
            placeholder={`[` +
              `\n  { "user": "Hi there!", "character": "Hey! *waves energetically*" },` +
              `\n  { "user": "How are you?", "character": "Living the dream, one coffee at a time." }` +
              `\n]`
            }
          />

          <label className="block text-sm mb-1 text-parchment/70">Tags (optional, comma-separated)</label>
          <input
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="w-full mb-6 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
            placeholder="e.g. fantasy, romance, adventure, comedy"
          />

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-gold text-ink px-6 py-2.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <Link
              href={`/chat/${character.id}`}
              className="border border-parchment/30 px-6 py-2.5 rounded-full font-medium hover:border-gold focus-ring"
            >
              Go to chat
            </Link>
          </div>
        </form>
      </div>
    </main>
    </AppShell>
    </RequireAuth>
  );
}
