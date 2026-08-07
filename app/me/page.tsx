"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import AppShell from "@/components/AppShell";
import { PremiumLockBadge } from "@/components/PremiumActionButton";
import { clearAuthCache } from "@/lib/authCache";
import { clearAuthToken } from "@/lib/authToken";

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

type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  username?: string | null;
  highlights?: string | null;
  avatarUrl?: string | null;
  explicitMode?: boolean;
  blurExplicitImages?: boolean;
  defaultModel?: string | null;
  preferredLanguage?: string | null;
};

function slugifyAvatar(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `/assets/characters/${slug}.png`;
}

export default function MePage() {
  const router = useRouter();
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [tab, setTab] = useState<"creations" | "collect" | "gallery">("creations");
  const [editingProfile, setEditingProfile] = useState(false);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [highlights, setHighlights] = useState("");
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [generatingAvatar, setGeneratingAvatar] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingSaving, setSettingSaving] = useState<string | null>(null);
  const [settingMsg, setSettingMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch("/api/auth/me")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (!d.user) return;
        setProfile(d.user);
        setUsername(d.user.username ?? d.user.displayName ?? "");
        setName(d.user.displayName ?? "");
        setHighlights(d.user.highlights ?? "");
        setAvatarPreview(d.user.avatarUrl ?? null);
      });
    apiFetch("/api/characters")
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((d) => setCharacters(d.characters ?? []));
  }, []);

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    clearAuthCache();
    clearAuthToken();
    router.push("/");
    router.refresh();
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PUT",
        body: JSON.stringify({
          displayName: name,
          username,
          highlights,
          explicitMode: profile?.explicitMode,
          blurExplicitImages: profile?.blurExplicitImages,
          defaultModel: profile?.defaultModel,
          preferredLanguage: profile?.preferredLanguage,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save profile.");
      setSaveMsg("Profile saved.");
      if (data.user) {
        setProfile(data.user);
        if (data.user.displayName) setName(data.user.displayName);
        if (data.user.username) setUsername(data.user.username);
      }
    } catch (err: any) {
      setSaveMsg(err.message || "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setSaveMsg(null);
    try {
      const form = new FormData();
      form.append("avatar", file);
      const res = await apiFetch("/api/auth/avatar", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      setAvatarPreview(data.user?.avatarUrl ?? null);
      setProfile((p) => (p ? { ...p, avatarUrl: data.user?.avatarUrl ?? p.avatarUrl } : p));
      setSaveMsg("Avatar updated.");
    } catch (err: any) {
      setSaveMsg(err.message || "Avatar upload failed.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleGenerateAvatar() {
    setGeneratingAvatar(true);
    setSaveMsg(null);
    try {
      const res = await apiFetch("/api/auth/avatar/generate", { method: "POST", body: JSON.stringify({}) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Avatar generation failed.");
      setAvatarPreview(data.user?.avatarUrl ?? null);
      setProfile((p) => (p ? { ...p, avatarUrl: data.user?.avatarUrl ?? p.avatarUrl } : p));
      setSaveMsg("Avatar generated.");
    } catch (err: any) {
      setSaveMsg(err.message || "Avatar generation failed.");
    } finally {
      setGeneratingAvatar(false);
    }
  }

  // Saves a single General-section setting immediately, with optimistic
  // update + rollback on failure.
  async function updateSetting<K extends keyof UserProfile>(key: K, value: UserProfile[K]) {
    const previous = profile?.[key];
    setProfile((p) => (p ? { ...p, [key]: value } : p));
    setSettingSaving(key);
    setSettingMsg(null);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PUT",
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to save setting.");
      if (data.user) setProfile(data.user);
    } catch (err: any) {
      setProfile((p) => (p ? { ...p, [key]: previous } : p));
      setSettingMsg(err.message || "Couldn't save that setting. Try again.");
    } finally {
      setSettingSaving(null);
    }
  }

  const displayName = profile?.displayName ?? "";
  const email = profile?.email ?? "";
  const initial = (displayName || email || "?").charAt(0).toUpperCase();

  return (
    <RequireAuth>
      <AppShell>
        <div className="flex-1 overflow-y-auto px-4 md:px-10 py-8 pb-28 max-w-3xl mx-auto w-full">
          <div className="flex items-start gap-4 mb-4 p-6 rounded-2xl bg-gradient-to-br from-surface-card to-surface-raised border border-white/5">
            <span className="relative w-20 h-20 rounded-full bg-gradient-to-br from-gold/30 to-plum/50 flex items-center justify-center text-3xl font-display shrink-0 shadow-lg ring-1 ring-white/5 overflow-hidden">
              {avatarPreview ? (
                <img src={resolveMediaUrl(avatarPreview)!} alt="" className="w-full h-full object-cover" />
              ) : (
                initial
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="font-display text-xl truncate gradient-text">{displayName || "Your profile"}</h1>
              <p className="text-xs text-parchment/40 truncate">{email}</p>
              <p className="text-xs text-parchment/45 mt-2">0 followers · 0 interactions</p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-3 py-1.5">
                <span aria-hidden className="text-gold">♛</span>
                <span className="text-xs text-parchment/80">Lite</span>
                <PremiumLockBadge />
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setEditingProfile((v) => !v)}
                className="text-xs text-parchment/70 hover:text-gold border border-white/10 px-3 py-1.5 rounded-full focus-ring transition-colors hover:border-gold/40"
              >
                {editingProfile ? "Close" : "Edit profile"}
              </button>
              <button
                type="button"
                onClick={logout}
                className="text-xs text-parchment/45 hover:text-rose border border-white/10 px-3 py-1.5 rounded-full focus-ring transition-colors hover:bg-rose/5"
              >
                Log out
              </button>
            </div>
          </div>

          {editingProfile && (
            <div className="mb-8 rounded-2xl bg-gradient-to-br from-surface-card to-surface-raised border border-white/5 p-6">
              <h2 className="font-display text-xl gradient-text mb-6">Profile Settings</h2>

              <form onSubmit={handleSaveProfile} className="space-y-5">
                {/* Avatar */}
                <div>
                  <div className="flex items-center gap-4">
                    <span className="relative w-16 h-16 rounded-full bg-gradient-to-br from-gold/30 to-plum/50 flex items-center justify-center text-2xl font-display shrink-0 shadow-lg ring-1 ring-white/5 overflow-hidden">
                      {avatarPreview ? (
                        <img src={resolveMediaUrl(avatarPreview)!} alt="" className="w-full h-full object-cover" />
                      ) : (
                        initial
                      )}
                    </span>
                    <div className="flex gap-2">
                      <button type="button" onClick={handleGenerateAvatar} disabled={generatingAvatar} className="text-xs border border-white/10 px-3 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50 transition-colors">
                        {generatingAvatar ? "Generating…" : "✨ Generate"}
                      </button>
                      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploadingAvatar} className="text-xs border border-white/10 px-3 py-1.5 rounded-full hover:border-gold focus-ring disabled:opacity-50 transition-colors">
                        {uploadingAvatar ? "Uploading…" : "📤 Upload"}
                      </button>
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleAvatarUpload} />
                  </div>
                  <p className="text-[10px] text-parchment/40 mt-2">Choose an avatar for your persona.</p>
                </div>

                {/* Username */}
                <div>
                  <label className="block text-xs text-parchment/70 mb-1">Username <span className="text-rose">*</span></label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
                  />
                  <div className="flex items-start justify-between mt-1">
                    <p className="text-[10px] text-parchment/40">Your unique public name visible to community.</p>
                    <p className="text-[10px] text-parchment/40 shrink-0 ml-2">{username.length}/20</p>
                  </div>
                </div>

                {/* Name */}
                <div>
                  <label className="block text-xs text-parchment/70 mb-1">Name <span className="text-rose">*</span></label>
                  <input
                    type="text"
                    required
                    maxLength={20}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm"
                  />
                  <div className="flex items-start justify-between mt-1">
                    <p className="text-[10px] text-parchment/40">The name you&apos;ll use for chatting</p>
                    <p className="text-[10px] text-parchment/40 shrink-0 ml-2">{name.length}/20</p>
                  </div>
                </div>

                {/* Current Plan */}
                <div className="flex items-center justify-between rounded-xl border border-white/5 bg-surface-raised/50 p-4">
                  <div className="flex items-center gap-3">
                    <span className="text-gold text-lg">✦</span>
                    <div>
                      <p className="text-sm font-medium text-parchment/80">Free plan <span className="text-[10px] border border-gold/30 bg-gold/10 text-gold px-1.5 py-0.5 rounded-full ml-1">FREE</span></p>
                      <p className="text-xs text-parchment/40">No active subscription</p>
                    </div>
                  </div>
                  <Link href="/plus" className="text-xs text-gold hover:text-gold/80 transition-colors">Upgrade &rsaquo;</Link>
                </div>

                {/* Highlights */}
                <div>
                  <label className="block text-xs text-parchment/70 mb-1">Highlights</label>
                  <textarea
                    value={highlights}
                    onChange={(e) => setHighlights(e.target.value)}
                    maxLength={1000}
                    rows={4}
                    className="w-full rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring text-sm resize-none"
                    placeholder="A petite and slim 22 years old girl, with lavender-long hair, silver-gray eyes…"
                  />
                  <div className="flex items-start justify-between mt-1">
                    <p className="text-[10px] text-parchment/40">Adds background context to guide the AI.</p>
                    <p className="text-[10px] text-parchment/40 shrink-0 ml-2">{highlights.length}/1000</p>
                  </div>
                </div>

                {/* Save */}
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={saving} className="bg-gold text-ink px-5 py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine text-sm disabled:opacity-60">
                    {saving ? "Saving…" : "Save profile"}
                  </button>
                  {saveMsg && <span className="text-xs text-parchment/60">{saveMsg}</span>}
                </div>
              </form>

              {/* General */}
              <div className="mt-8 border-t border-white/5 pt-6">
                <h3 className="font-display text-base text-parchment/80 mb-4">General</h3>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-parchment/80 flex items-center gap-2">Display explicit content</p>
                      <p className="text-xs text-parchment/40">Confirm that you are over 18 years of age</p>
                    </div>
                    <button
                      type="button"
                      disabled={settingSaving === "explicitMode"}
                      onClick={() => updateSetting("explicitMode", !profile?.explicitMode)}
                      className={`w-10 h-6 rounded-full transition-colors relative disabled:opacity-60 ${profile?.explicitMode ? "bg-gold" : "bg-white/10"}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile?.explicitMode ? "translate-x-4" : ""}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-parchment/80 flex items-center gap-2">Blur explicit images</p>
                      <p className="text-xs text-parchment/40">Blurs mature and adult media</p>
                    </div>
                    <button
                      type="button"
                      disabled={settingSaving === "blurExplicitImages"}
                      onClick={() => updateSetting("blurExplicitImages", !profile?.blurExplicitImages)}
                      className={`w-10 h-6 rounded-full transition-colors relative disabled:opacity-60 ${profile?.blurExplicitImages ? "bg-gold" : "bg-white/10"}`}
                    >
                      <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${profile?.blurExplicitImages ? "translate-x-4" : ""}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-parchment/80 flex items-center gap-2">Default Model</p>
                      <p className="text-xs text-parchment/40">Switch to a different AI model</p>
                    </div>
                    <div className="relative">
                      <select
                        value={profile?.defaultModel || "default"}
                        disabled={settingSaving === "defaultModel"}
                        onChange={(e) => updateSetting("defaultModel", e.target.value)}
                        className="text-xs text-parchment/70 bg-plum-deep border border-white/10 pl-3 pr-6 py-1.5 rounded-full hover:border-gold focus-ring transition-colors disabled:opacity-60 appearance-none cursor-pointer"
                      >
                        <option value="default">Default</option>
                        <option value="creative">Creative</option>
                        <option value="precise">Precise</option>
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-parchment/40">▸</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-parchment/80 flex items-center gap-2">Preferred Chat Language</p>
                      <p className="text-xs text-parchment/40">Change the language used in Chat</p>
                    </div>
                    <div className="relative">
                      <select
                        value={profile?.preferredLanguage || "English"}
                        disabled={settingSaving === "preferredLanguage"}
                        onChange={(e) => updateSetting("preferredLanguage", e.target.value)}
                        className="text-xs text-parchment/70 bg-plum-deep border border-white/10 pl-3 pr-6 py-1.5 rounded-full hover:border-gold focus-ring transition-colors disabled:opacity-60 appearance-none cursor-pointer"
                      >
                        <option>English</option>
                        <option>Spanish</option>
                        <option>French</option>
                        <option>German</option>
                        <option>Portuguese</option>
                        <option>Japanese</option>
                      </select>
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-parchment/40">▸</span>
                    </div>
                  </div>
                  {settingMsg && <p className="text-xs text-rose">{settingMsg}</p>}
                </div>
              </div>

              {/* Advanced */}
              <div className="mt-6">
                <button type="button" onClick={() => setAdvancedOpen((o) => !o)} className="flex items-center gap-2 text-xs text-parchment/50 hover:text-gold transition-colors">
                  Advanced <span className="text-[10px] border border-white/10 rounded px-1.5 py-0.5">{advancedOpen ? "▴" : "▾"}</span>
                </button>
                {advancedOpen && (
                  <div className="mt-3 p-4 rounded-xl border border-dashed border-white/10 text-xs text-parchment/40">
                    Advanced settings coming soon.
                  </div>
                )}
              </div>
            </div>
          )}

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