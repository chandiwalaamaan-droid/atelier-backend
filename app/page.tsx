"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, resolveMediaUrl } from "@/lib/api";
import { getCachedUser, fetchAndCacheUser } from "@/lib/authCache";
import { clearAuthCache } from "@/lib/authCache";
import { clearAuthToken } from "@/lib/authToken";

const FEATURED_CHARACTERS = [
  { name: "Nyra Shadow", tagline: "mysterious enchantress", emoji: "🌙", color: "#8b5cf6" },
  { name: "Evelyn Rose", tagline: "romantic poet", emoji: "🌹", color: "#b5657a" },
  { name: "Damien Black", tagline: "brooding detective", emoji: "🕵️", color: "#06b6d4" },
  { name: "Luna Voss", tagline: "celestial wanderer", emoji: "✨", color: "#c9a227" },
  { name: "Mistress Vesper", tagline: "dominatrix extraordinaire", emoji: "💋", color: "#d946ef" },
  { name: "Victor Kane", tagline: "vampire aristocrat", emoji: "🦇", color: "#8a3d54" },
];

type Character = {
  id: string;
  name: string;
  tagline: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  accentColor: string;
  isPublic?: boolean;
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

export default function Home() {
  const router = useRouter();
  const [authStatus, setAuthStatus] = useState<"checking" | "authed" | "guest">("checking");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loadingChars, setLoadingChars] = useState(false);

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
    let cancelled = false;
    const cached = getCachedUser();
    if (cached?.user) {
      setAuthStatus("authed");
      setDisplayName(cached.user.displayName);
      setEmail(cached.user.email);
      fetchAndCacheUser().then((user) => {
        if (cancelled) return;
        if (!user) {
          setAuthStatus("guest");
          setDisplayName("");
          setEmail("");
        } else {
          setDisplayName(user.displayName);
          setEmail(user.email);
        }
      });
    } else {
      setAuthStatus("guest");
      fetchAndCacheUser().then((user) => {
        if (cancelled) return;
        if (user) {
          setAuthStatus("authed");
          setDisplayName(user.displayName);
          setEmail(user.email);
        }
      });
    }
    return () => { cancelled = true; };
  }, [router]);

  useEffect(() => {
    if (authStatus !== "authed") return;
    let cancelled = false;
    setLoadingChars(true);
    apiFetch("/api/characters")
      .then((r) => (r.ok ? r.json() : { characters: [] }))
      .then((d) => {
        if (!cancelled) setCharacters(d.characters ?? []);
      })
      .catch(() => {
        if (!cancelled) setCharacters([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingChars(false);
      });

    apiFetch("/api/auth/me")
      .then((r) => r.json().catch(() => ({})))
      .then((d) => {
        if (!cancelled && d.user) {
          setProfile(d.user);
          setUsername(d.user.username ?? d.user.displayName ?? "");
          setName(d.user.displayName ?? "");
          setHighlights(d.user.highlights ?? "");
          setAvatarPreview(d.user.avatarUrl ?? null);
          setEmailVerified(d.user.emailVerified ?? false);
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [authStatus]);

  if (authStatus === "checking") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-void">
        <p className="text-parchment/60">Loading…</p>
      </main>
    );
  }

  if (authStatus === "guest") {
    return (
      <main className="min-h-screen flex flex-col bg-void relative overflow-hidden aurora-bg">
        <div
          className="absolute top-[-10%] left-[-5%] w-[500px] h-[500px] rounded-full opacity-[0.06] pointer-events-none"
          style={{
            background: "radial-gradient(circle, #c9a227 0%, transparent 70%)",
            animation: "float 8s ease-in-out infinite",
          }}
          aria-hidden
        />
        <div
          className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] rounded-full opacity-[0.06] pointer-events-none"
          style={{
            background: "radial-gradient(circle, #b5657a 0%, transparent 70%)",
            animation: "float 8s ease-in-out infinite",
            animationDelay: "-4s",
          }}
          aria-hidden
        />
        <div
          className="absolute top-[40%] right-[15%] w-[300px] h-[300px] rounded-full opacity-[0.04] pointer-events-none"
          style={{
            background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)",
            animation: "float 6s ease-in-out infinite",
            animationDelay: "-2s",
          }}
          aria-hidden
        />

        <header className="relative z-10 flex items-center justify-between px-4 py-4 sm:px-6 sm:py-5 md:px-12 md:py-5 border-b border-white/5 backdrop-blur-sm">
          <span className="font-display text-xl tracking-wide flex items-center gap-2">
            <span className="text-lg animate-bounce-slow">🌸</span>
            <span className="shimmer-text">Rolichat</span>
          </span>
          <nav className="flex gap-2 sm:gap-3 text-xs sm:text-sm">
            <Link href="/login" className="hover:text-gold focus-ring rounded-full px-3 py-1.5 sm:px-4 sm:py-2 transition-colors hover:bg-white/5">Log in</Link>
            <Link href="/signup" className="bg-gold text-ink px-3 py-1.5 sm:px-5 sm:py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine inline-block shadow-lg shadow-gold/20 text-xs sm:text-base">Get started</Link>
          </nav>
        </header>

        <section className="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-6 md:px-12 py-16">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass-gold text-gold text-xs mb-8 animate-fade-in">
            <span className="w-2 h-2 rounded-full bg-gold animate-sparkle glow-dot text-gold" />
            a workshop for characters
          </div>

          <h1 className="font-display text-5xl md:text-7xl lg:text-8xl max-w-4xl leading-tight animate-fade-in-up">
            Give a personality a <span className="shimmer-text">voice</span>,<br />then talk to it.
          </h1>

          <p className="mt-8 max-w-xl text-parchment/60 font-body text-lg leading-relaxed animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
            Craft unique characters with rich personalities and backstories.
            Every character you make is <span className="text-parchment/90 font-medium">private, editable, and ready whenever you are.</span>
          </p>

          <div className="mt-12 flex flex-col sm:flex-row gap-4 animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
            <Link href="/signup" className="bg-gold text-ink px-8 py-4 rounded-full font-medium hover:brightness-110 focus-ring btn-shine text-lg shadow-xl shadow-gold/20 animate-pulse-glow">Create your first character</Link>
            <Link href="/login" className="border border-parchment/25 px-8 py-4 rounded-full font-medium hover:border-gold focus-ring transition-all hover:bg-white/5">I already have an account</Link>
          </div>

          <div className="mt-16 flex flex-wrap justify-center gap-8 md:gap-16 animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <div className="text-center">
              <p className="font-display text-3xl gradient-text">∞</p>
              <p className="text-xs text-parchment/40 mt-1">Characters</p>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div className="text-center">
              <p className="font-display text-3xl gradient-text">100%</p>
              <p className="text-xs text-parchment/40 mt-1">Private</p>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div className="text-center">
              <p className="font-display text-3xl gradient-text">AI</p>
              <p className="text-xs text-parchment/40 mt-1">Powered</p>
            </div>
          </div>
        </section>

        <section className="relative z-10 px-6 md:px-12 py-12">
          <div className="text-center mb-8">
            <p className="text-xs text-gold/60 uppercase tracking-widest mb-2">Meet the cast</p>
            <h2 className="font-display text-2xl md:text-3xl gradient-text">Characters waiting for you</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 max-w-5xl mx-auto">
            {FEATURED_CHARACTERS.map((char, i) => (
              <div key={char.name} className="group cursor-pointer animate-fade-in-up" style={{ animationDelay: `${0.4 + i * 0.08}s` }}>
                <div className="relative aspect-[3/4] rounded-2xl overflow-hidden border border-white/5 card-hover" style={{ background: `linear-gradient(160deg, ${char.color}30, #121218)` }}>
                  <div className="absolute inset-0 flex items-center justify-center text-5xl group-hover:scale-110 transition-transform duration-500">{char.emoji}</div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                  <div className="absolute bottom-0 left-0 right-0 p-3">
                    <p className="font-display text-sm font-medium text-parchment truncate">{char.name}</p>
                    <p className="text-[10px] text-parchment/50 truncate">{char.tagline}</p>
                  </div>
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300" style={{ boxShadow: `inset 0 0 30px ${char.color}20` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="relative z-10 stitched mx-6 mb-12 md:mx-12 rounded-2xl bg-gradient-to-br from-plum/40 via-plum/50 to-plum-deep/60 backdrop-blur-sm px-8 py-10 grid gap-8 grid-cols-1 md:grid-cols-3 border-glow-gold">
          <div className="animate-fade-in-up" style={{ animationDelay: "0.3s" }}>
            <div className="w-10 h-10 rounded-full bg-gold/15 flex items-center justify-center mb-3"><span className="text-gold font-display font-bold">01</span></div>
            <p className="font-display text-lg text-gold mb-2">Craft</p>
            <p className="text-sm text-parchment/60 leading-relaxed">Name a character, describe their traits and background, and write the line they open with.</p>
          </div>
          <div className="animate-fade-in-up" style={{ animationDelay: "0.4s" }}>
            <div className="w-10 h-10 rounded-full bg-gold/15 flex items-center justify-center mb-3"><span className="text-gold font-display font-bold">02</span></div>
            <p className="font-display text-lg text-gold mb-2">Converse</p>
            <p className="text-sm text-parchment/60 leading-relaxed">Chat naturally. Each character remembers your conversation with them, and only them.</p>
          </div>
          <div className="animate-fade-in-up" style={{ animationDelay: "0.5s" }}>
            <div className="w-10 h-10 rounded-full bg-gold/15 flex items-center justify-center mb-3"><span className="text-gold font-display font-bold">03</span></div>
            <p className="font-display text-lg text-gold mb-2">Iterate</p>
            <p className="text-sm text-parchment/60 leading-relaxed">Edit a character&apos;s backstory any time and the next reply reflects the change.</p>
          </div>
        </div>

        <footer className="relative z-10 px-6 pb-10 md:px-12 flex flex-wrap gap-x-6 gap-y-2 text-xs text-parchment/40">
          <span>Rolichat is for adults 18+.</span>
          <Link href="/terms" className="hover:text-gold transition-colors">Terms of Service & Content Policy</Link>
          <Link href="/privacy" className="hover:text-gold transition-colors">Privacy Policy</Link>
        </footer>
      </main>
    );
  }

  const initial = (displayName || email || "?").charAt(0).toUpperCase();

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await apiFetch("/api/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
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
      setProfile(data.user ?? null);
      setDisplayName(name);
      if (data.user?.displayName) setDisplayName(data.user.displayName);
      if (data.user?.username) setUsername(data.user.username);
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

  // Saves a single General-section setting immediately (rather than only on
  // the big "Save profile" click above) — that's the UX these toggles/pickers
  // imply, and it's what makes them feel "wired up" rather than decorative.
  // Optimistic update with rollback on failure.
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
      setProfile((p) => (p ? { ...p, [key]: previous } : p)); // roll back
      setSettingMsg(err.message || "Couldn't save that setting. Try again.");
    } finally {
      setSettingSaving(null);
    }
  }

  async function handleLogout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    clearAuthCache();
    clearAuthToken();
    router.push("/");
    router.refresh();
  }

  return (
    <main className="min-h-screen flex flex-col bg-void">
      <header className="border-b border-white/5 bg-surface-raised/60 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto w-full px-4 py-4 flex items-center justify-between">
          <Link href="/" className="font-display text-xl tracking-wide flex items-center gap-2">
            <span className="text-lg">🌸</span>
            <span className="shimmer-text">Rolichat</span>
          </Link>
          <Link href="/dashboard" className="bg-gold text-ink px-4 py-2 rounded-full font-medium hover:brightness-110 focus-ring btn-shine text-sm shadow-lg shadow-gold/20">Studio</Link>
        </div>
      </header>

      <div className="flex-1">
        <div className="max-w-5xl mx-auto w-full px-4 py-8 space-y-8">
          {/* Me Section */}
          <section className="rounded-2xl bg-gradient-to-br from-surface-card to-surface-raised border border-white/5 p-6">
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

            {/* Signout */}
            <div className="mt-8 border-t border-white/5 pt-6 flex items-center justify-between">
              <div>
                <p className="text-sm text-parchment/70">Sign out</p>
                <p className="text-xs text-parchment/40">Log out of your account safely</p>
              </div>
              <button type="button" onClick={handleLogout} className="text-xs border border-white/10 px-4 py-1.5 rounded-full hover:border-rose hover:text-rose focus-ring transition-colors">Sign Out</button>
            </div>
          </section>

          {/* My Characters Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl gradient-text">My Characters</h2>
              <Link href="/dashboard" className="text-xs text-gold hover:text-gold/80 transition-colors font-medium">Create new →</Link>
            </div>
            {loadingChars ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-xl bg-surface-card border border-white/5 animate-pulse shimmer" />
                ))}
              </div>
            ) : characters.length === 0 ? (
              <div className="text-center py-16 text-parchment/45 rounded-2xl border border-dashed border-white/10">
                <span className="text-4xl block mb-3 opacity-50">🎭</span>
                <p className="font-display text-lg mb-1">No characters yet</p>
                <p className="text-sm text-parchment/40 mb-6">Create your first character in Studio.</p>
                <Link href="/dashboard" className="bg-gold text-ink px-6 py-2.5 rounded-full font-medium hover:brightness-110 focus-ring btn-shine inline-block shadow-lg shadow-gold/20 text-sm">+ Create</Link>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {characters.map((c) => (
                  <li key={c.id}>
                    <Link href={`/chat/${c.id}`} className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-r from-surface-card to-surface-raised border border-white/5 hover:border-gold/20 focus-ring transition-all card-hover">
                      <span className="relative w-12 h-12 rounded-full flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-white/5" style={{ backgroundColor: `${c.accentColor}35` }}>
                        <span className="text-xl">{c.avatarEmoji}</span>
                        <img src={c.avatarUrl ? resolveMediaUrl(c.avatarUrl) : slugifyAvatar(c.name)} alt={c.name} className="absolute inset-0 w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium truncate">{c.name}</span>
                        <span className="block text-xs text-parchment/45 truncate">{c.tagline}</span>
                      </span>
                      {c.isPublic && (
                        <span className="text-[10px] text-gold/60 border border-gold/20 px-2 py-0.5 rounded-full">Public</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
