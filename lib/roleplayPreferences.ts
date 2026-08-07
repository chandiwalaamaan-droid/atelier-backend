/** Per-character chat preferences for mature roleplay (stored locally only). */

import type { RoleplayEngineId } from "./roleplayEngines";
import { applyEngine, resolveEngineId, ROLEPLAY_ENGINES } from "./roleplayEngines";

export type SpiceLevel = "flirty" | "spicy" | "explicit";
export type RoleplayStyle = "balanced" | "narrative" | "dialogue" | "slow_burn" | "intense";

export type RoleplayPreferences = {
  explicitMode: boolean;
  spiceLevel: SpiceLevel;
  roleplayStyle: RoleplayStyle;
  engineId?: RoleplayEngineId;
};

const DEFAULTS: RoleplayPreferences = {
  explicitMode: false,
  spiceLevel: "spicy",
  roleplayStyle: "balanced",
};

function storageKey(characterId: string) {
  return `rolichat:roleplay:${characterId}`;
}

function defaultPrefs(characterIsExplicit: boolean): RoleplayPreferences {
  const engine = ROLEPLAY_ENGINES.find((e) =>
    characterIsExplicit ? e.id === "grape" : e.id === "vanilla"
  );
  if (!engine) {
    return { ...DEFAULTS, engineId: "custom" };
  }
  return { ...applyEngine(engine), engineId: engine.id };
}

export function loadRoleplayPreferences(characterId: string, characterIsExplicit: boolean): RoleplayPreferences {
  if (typeof window === "undefined") {
    return defaultPrefs(characterIsExplicit);
  }
  try {
    const raw = localStorage.getItem(storageKey(characterId));
    if (!raw) {
      return defaultPrefs(characterIsExplicit);
    }
    const parsed = JSON.parse(raw) as Partial<RoleplayPreferences>;
    const spiceLevel =
      parsed.spiceLevel === "flirty" || parsed.spiceLevel === "spicy" || parsed.spiceLevel === "explicit"
        ? parsed.spiceLevel
        : DEFAULTS.spiceLevel;
    const roleplayStyle =
      parsed.roleplayStyle === "balanced" ||
      parsed.roleplayStyle === "narrative" ||
      parsed.roleplayStyle === "dialogue" ||
      parsed.roleplayStyle === "slow_burn" ||
      parsed.roleplayStyle === "intense"
        ? parsed.roleplayStyle
        : DEFAULTS.roleplayStyle;
    return {
      explicitMode: parsed.explicitMode === true,
      spiceLevel,
      roleplayStyle,
      engineId: resolveEngineId(
        { explicitMode: parsed.explicitMode === true, spiceLevel, roleplayStyle },
        parsed.engineId
      ),
    };
  } catch {
    return defaultPrefs(characterIsExplicit);
  }
}

export function saveRoleplayPreferences(characterId: string, prefs: RoleplayPreferences) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(characterId), JSON.stringify(prefs));
}

export const SPICE_LEVEL_LABELS: Record<SpiceLevel, string> = {
  flirty: "Flirty",
  spicy: "Spicy",
  explicit: "Explicit",
};

export const ROLEPLAY_STYLE_LABELS: Record<RoleplayStyle, string> = {
  balanced: "Balanced",
  narrative: "Rich narration",
  dialogue: "Dialogue-forward",
  slow_burn: "Slow burn",
  intense: "Passionate",
};

export const SCENE_STEERS: { label: string; directive: string }[] = [
  { label: "Turn up the heat", directive: "Escalate tension and intimacy in this scene; stay in character." },
  { label: "Slow down", directive: "Pull back to teasing, emotional intimacy, and anticipation rather than rushing." },
  { label: "You take the lead", directive: "Drive the scene forward with bold initiative while checking in with the user." },
  { label: "More detail", directive: "Use richer sensory description and longer, immersive replies." },
];
