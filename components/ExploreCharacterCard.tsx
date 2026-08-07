"use client";

import { resolveMediaUrl } from "@/lib/api";

export type ExploreCardCharacter = {
  id: string;
  name: string;
  tagline: string;
  personality: string;
  avatarEmoji: string;
  avatarUrl: string | null;
  accentColor: string;
  owner?: { displayName: string } | null;
  tags?: string;
};

function slugifyAvatar(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `/assets/characters/${slug}.png`;
}

const TAG_RULES: { tag: string; re: RegExp }[] = [
  { tag: "Romance", re: /romance|love|girlfriend|boyfriend|wife|husband|dating/i },
  { tag: "Drama", re: /drama|conflict|secret|betray/i },
  { tag: "Slice of life", re: /family|everyday|roommate|neighbor|slice/i },
  { tag: "Adventure", re: /adventure|quest|travel|apocalypse|survival/i },
  { tag: "Comedy", re: /funny|comedy|wit|humor|playful/i },
  { tag: "Fantasy", re: /magic|dragon|fantasy|realm|witch/i },
];

export function inferTags(c: ExploreCardCharacter): string[] {
  const text = `${c.tagline} ${c.personality} ${c.name}`;
  const tags = TAG_RULES.filter(({ re }) => re.test(text)).map(({ tag }) => tag);
  return tags.length ? tags.slice(0, 3) : ["Roleplay"];
}

export function pseudoViews(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const n = 50_000 + (h % 4_950_000);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1000).toFixed(1)}K`;
}

type Props = {
  character: ExploreCardCharacter;
  onRemix: () => void;
  remixing: boolean;
  onReport: () => void;
};

export default function ExploreCharacterCard({ character: c, onRemix, remixing, onReport }: Props) {
  let tags: string[];
  try {
    const parsed = c.tags ? JSON.parse(c.tags) : [];
    tags = Array.isArray(parsed) ? parsed.slice(0, 5) : inferTags(c);
  } catch {
    tags = inferTags(c);
  }
  if (!tags.length) tags = inferTags(c);
  const blurb = c.tagline || c.personality;

  return (
    <article className="group rounded-2xl overflow-hidden bg-gradient-to-b from-surface-card to-surface-raised border border-white/5 hover:border-gold/30 transition-all duration-300 flex flex-col card-hover">
      <div className="relative aspect-[3/4] bg-surface-raised overflow-hidden">
        {c.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolveMediaUrl(c.avatarUrl)}
            alt=""
            className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-500"
          />
        ) : (
          <img
            src={slugifyAvatar(c.name)}
            alt={c.name}
            className="w-full h-full object-cover group-hover:scale-[1.05] transition-transform duration-500"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const parent = img.parentElement;
              if (parent) {
                const fallback = parent.querySelector('.emoji-fallback');
                if (fallback) (fallback as HTMLDivElement).style.display = 'flex';
              }
            }}
          />
        )}
        <div
          className="emoji-fallback w-full h-full items-center justify-center text-6xl transition-transform duration-500 group-hover:scale-110 hidden"
          style={{ background: `linear-gradient(160deg, ${c.accentColor}44, #121218)` }}
        >
          {c.avatarEmoji}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <span className="absolute top-2 left-2 text-[11px] font-medium px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm border border-white/5">
          {pseudoViews(c.id)}
        </span>
        {c.owner && (
          <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 rounded-full bg-black/55 backdrop-blur-sm text-parchment/60 border border-white/5">
            by {c.owner.displayName}
          </span>
        )}
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-parchment truncate group-hover:text-gold transition-colors">{c.name}</h3>
        <p className="text-xs text-parchment/50 line-clamp-2 mt-1 min-h-[2.5rem] leading-relaxed">{blurb}</p>
        <div className="flex flex-wrap gap-1 mt-2 mb-3">
          {tags.map((t) => (
            <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-parchment/45 border border-white/5">
              {t}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={onRemix}
          disabled={remixing}
          className="mt-auto w-full py-2 rounded-full bg-gold text-ink text-sm font-medium hover:brightness-110 focus-ring disabled:opacity-50 btn-shine transition-all"
        >
          {remixing ? "Adding…" : "Chat"}
        </button>
        <button type="button" onClick={onReport} className="mt-2 text-[10px] text-parchment/35 hover:text-rose focus-ring transition-colors">
          Report
        </button>
      </div>
    </article>
  );
}

export function ExploreCharacterCardSkeleton() {
  return (
    <div className="rounded-2xl overflow-hidden bg-surface-card border border-white/5 animate-pulse">
      <div className="aspect-[3/4] shimmer" />
      <div className="p-3 space-y-2">
        <div className="h-4 w-2/3 bg-white/10 rounded" />
        <div className="h-3 w-full bg-white/5 rounded" />
        <div className="h-8 w-full bg-white/10 rounded-full mt-4" />
      </div>
    </div>
  );
}