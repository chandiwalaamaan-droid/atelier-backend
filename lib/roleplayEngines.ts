import type { RoleplayPreferences, RoleplayStyle, SpiceLevel } from "./roleplayPreferences";

export type RoleplayEngineId =
  | "vanilla"
  | "vanilla_short"
  | "green_apple"
  | "cayenne"
  | "saffron"
  | "cardamom"
  | "rosemary"
  | "cookie"
  | "grape"
  | "custom";

export type RoleplayEngine = {
  id: Exclude<RoleplayEngineId, "custom">;
  name: string;
  emoji: string;
  /** Intensity / depth hint (1–10), not a paywall — all engines are free on Rolichat. */
  badge: number;
  tag?: string;
  description: string;
  section: "free" | "premium";
  spiceLevel: SpiceLevel;
  roleplayStyle: RoleplayStyle;
};

export const ROLEPLAY_ENGINES: RoleplayEngine[] = [
  // ============================================
  // FREE TIER - Entry level, good quality basics
  // ============================================
  {
    id: "vanilla_short",
    name: "Vanilla Short",
    emoji: "⚡",
    badge: 2,
    description: "Quick, punchy responses — perfect for casual chats and light roleplay.",
    section: "free",
    spiceLevel: "flirty",
    roleplayStyle: "dialogue",
  },
  {
    id: "vanilla",
    name: "Vanilla",
    emoji: "🙂",
    badge: 3,
    description: "Solid, reliable character immersion — the everyday go-to for balanced roleplay.",
    section: "free",
    spiceLevel: "flirty",
    roleplayStyle: "balanced",
  },

  // ============================================
  // PREMIUM TIER - Professional grade experiences
  // ============================================

  // Budget Premium ($4-5) - Better than free, good value
  {
    id: "green_apple",
    name: "Green Apple",
    emoji: "🍏",
    badge: 4,
    tag: "Premium Entry",
    description: "Crisp, energetic banter — noticeably sharper than free engines. Great for lightweight fun.",
    section: "premium",
    spiceLevel: "flirty",
    roleplayStyle: "intense",
  },
  {
    id: "grape",
    name: "Grape",
    emoji: "🍇",
    badge: 5,
    description: "Atmospheric storytelling with emotional depth — your first step into premium quality.",
    section: "premium",
    spiceLevel: "spicy",
    roleplayStyle: "balanced",
  },

  // Mid Premium ($6-7) - Quality experiences
  {
    id: "cookie",
    name: "Cookie",
    emoji: "🍪",
    badge: 6,
    tag: "Popular",
    description: "Rich, literary prose with genuine feeling — sensual scenes that linger in your mind.",
    section: "premium",
    spiceLevel: "spicy",
    roleplayStyle: "narrative",
  },
  {
    id: "saffron",
    name: "Saffron",
    emoji: "🧡",
    badge: 7,
    tag: "Slow Burn",
    description: "Exquisite pacing and atmosphere —anticipation builds beautifully scene by scene.",
    section: "premium",
    spiceLevel: "spicy",
    roleplayStyle: "slow_burn",
  },

  // High Premium ($8-9) - Flagship experiences, worth every penny
  {
    id: "rosemary",
    name: "Rosemary",
    emoji: "🌿",
    badge: 8,
    tag: "Best Seller",
    description: "Unmatched immersive detail — every sensation, emotion, and nuance rendered perfectly. The premium standard.",
    section: "premium",
    spiceLevel: "explicit",
    roleplayStyle: "narrative",
  },
  {
    id: "cardamom",
    name: "Cardamom",
    emoji: "💜",
    badge: 8,
    tag: "Editor's Choice",
    description: "Dark, brooding intensity — relationship tension crackles with electric desire. Elite emotional depth.",
    section: "premium",
    spiceLevel: "spicy",
    roleplayStyle: "intense",
  },
  {
    id: "cayenne",
    name: "Cayenne",
    emoji: "🌶️",
    badge: 9,
    tag: "Ultimate Experience",
    description: "🔥 The most advanced AI roleplay available. Vivid, immediate, intensely personal — maximum quality for unforgettable moments.",
    section: "premium",
    spiceLevel: "explicit",
    roleplayStyle: "intense",
  },
];

export function engineById(id: RoleplayEngineId): RoleplayEngine | null {
  if (id === "custom") return null;
  return ROLEPLAY_ENGINES.find((e) => e.id === id) ?? null;
}

export function prefsMatchEngine(prefs: RoleplayPreferences, engine: RoleplayEngine): boolean {
  const explicitOk = engine.section === "premium" ? prefs.explicitMode : !prefs.explicitMode;
  return (
    explicitOk &&
    prefs.spiceLevel === engine.spiceLevel &&
    prefs.roleplayStyle === engine.roleplayStyle
  );
}

export function resolveEngineId(prefs: RoleplayPreferences, storedId?: RoleplayEngineId): RoleplayEngineId {
  if (storedId && storedId !== "custom") {
    const eng = engineById(storedId);
    if (eng && prefsMatchEngine(prefs, eng)) return storedId;
  }
  for (const engine of ROLEPLAY_ENGINES) {
    if (prefsMatchEngine(prefs, engine)) return engine.id;
  }
  return "custom";
}

export function applyEngine(engine: RoleplayEngine): RoleplayPreferences {
  return {
    explicitMode: engine.section === "premium",
    spiceLevel: engine.spiceLevel,
    roleplayStyle: engine.roleplayStyle,
  };
}

export function activeEngineLabel(prefs: RoleplayPreferences, engineId: RoleplayEngineId): string {
  if (engineId !== "custom") {
    const eng = engineById(engineId);
    if (eng) return eng.name;
  }
  if (prefs.explicitMode) return "Custom spice";
  return "Custom";
}

export function activeEngineEmoji(engineId: RoleplayEngineId): string {
  if (engineId === "custom") return "✦";
  return engineById(engineId)?.emoji ?? "✦";
}
