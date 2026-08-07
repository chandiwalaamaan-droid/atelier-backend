"use client";

/// <reference types="react" />
import { useEffect, useMemo, useState } from "react";
import {
  SPICE_LEVEL_LABELS,
  ROLEPLAY_STYLE_LABELS,
  SCENE_STEERS,
  type RoleplayPreferences,
  type RoleplayStyle,
  type SpiceLevel,
} from "@/lib/roleplayPreferences";
import {
  ROLEPLAY_ENGINES,
  applyEngine,
  activeEngineLabel,
  type RoleplayEngine,
  type RoleplayEngineId,
} from "@/lib/roleplayEngines";

type Props = {
  open: boolean;
  onClose: () => void;
  prefs: RoleplayPreferences;
  engineId: RoleplayEngineId;
  onApply: (prefs: RoleplayPreferences, engineId: RoleplayEngineId) => void;
  canSteerScene: boolean;
  onSteerScene: (directive: string) => void;
  steering: boolean;
};

function SlidersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 7h10M18 7h2M4 12h2M8 12h12M4 17h8M16 17h4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <circle cx="16" cy="7" r="2" fill="currentColor" />
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="14" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

function EngineCard({
  engine,
  selected,
  fineTuneOpen,
  onSelect,
  onToggleFineTune,
  prefs,
  onPatch,
}: {
  engine: RoleplayEngine;
  selected: boolean;
  fineTuneOpen: boolean;
  onSelect: () => void;
  onToggleFineTune: () => void;
  prefs: RoleplayPreferences;
  onPatch: (patch: Partial<RoleplayPreferences>, engineId: RoleplayEngineId) => void;
}) {
  return (
    <div className="space-y-2">
      <div
        className={`engine-card flex items-center gap-3 w-full text-left rounded-2xl border px-3 py-2.5 transition-all duration-200 ${
          selected
            ? "engine-card-selected border-gold/30 bg-plum-deep/80 shadow-lg shadow-gold/5"
            : "border-parchment/12 bg-plum/50 hover:border-parchment/25 hover:bg-plum/70"
        }`}
      >
        <button type="button" onClick={onSelect} className="flex flex-1 items-center gap-3 min-w-0 focus-ring rounded-xl">
          <span
            className="engine-avatar shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-xl"
            style={{ background: "linear-gradient(145deg, rgba(201,162,39,0.15), rgba(181,101,122,0.2))" }}
          >
            {engine.emoji}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-parchment truncate">{engine.name}</span>
              <span className="engine-badge inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-500/25 text-violet-100">
                <span aria-hidden>★</span>
                {engine.badge}
              </span>
              {engine.tag && (
                <span className="text-[10px] uppercase tracking-wide text-gold/70 font-medium">{engine.tag}</span>
              )}
            </span>
            <span className="block text-xs text-parchment/55 truncate mt-0.5">{engine.description}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onToggleFineTune}
          className={`shrink-0 p-2 rounded-lg focus-ring transition-all ${
            fineTuneOpen ? "text-gold bg-gold/10 rotate-180" : "text-parchment/40 hover:text-parchment/70 hover:bg-white/5"
          }`}
          title="Fine-tune heat and style"
          aria-label={`Fine-tune ${engine.name}`}
        >
          <SlidersIcon />
        </button>
      </div>
      {selected && fineTuneOpen && (
        <div className="ml-14 mr-1 space-y-3 pb-1 animate-fade-in">
          <div>
            <p className="text-[11px] text-parchment/45 mb-1.5 font-medium uppercase tracking-wider">Heat</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(SPICE_LEVEL_LABELS) as SpiceLevel[]).map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => onPatch({ spiceLevel: level }, engine.id)}
                  className={`text-xs rounded-full px-2.5 py-1 border focus-ring transition-all ${
                    prefs.spiceLevel === level
                      ? "bg-rose/25 border-rose/60 text-parchment shadow-md shadow-rose/10"
                      : "border-parchment/15 text-parchment/60 hover:border-rose/35 hover:bg-rose/5"
                  }`}
                >
                  {SPICE_LEVEL_LABELS[level]}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[11px] text-parchment/45 mb-1.5 font-medium uppercase tracking-wider">Writing style</p>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(ROLEPLAY_STYLE_LABELS) as RoleplayStyle[]).map((style) => (
                <button
                  key={style}
                  type="button"
                  onClick={() => onPatch({ roleplayStyle: style }, engine.id)}
                  className={`text-xs rounded-full px-2.5 py-1 border focus-ring transition-all ${
                    prefs.roleplayStyle === style
                      ? "bg-gold/15 border-gold/50 text-parchment shadow-md shadow-gold/10"
                      : "border-parchment/15 text-parchment/60 hover:border-gold/35 hover:bg-gold/5"
                  }`}
                >
                  {ROLEPLAY_STYLE_LABELS[style]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RoleplayModelPicker({
  open,
  onClose,
  prefs,
  engineId,
  onApply,
  canSteerScene,
  onSteerScene,
  steering,
}: Props) {
  const [fineTuneEngineId, setFineTuneEngineId] = useState<RoleplayEngineId | null>(null);

  useEffect(() => {
    if (!open) setFineTuneEngineId(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const freeEngines = useMemo(() => ROLEPLAY_ENGINES.filter((e) => e.section === "free"), []);
  const premiumEngines = useMemo(() => ROLEPLAY_ENGINES.filter((e) => e.section === "premium"), []);

  // Group premium engines by quality tier for better UX
  const budgetPremium = useMemo(() => premiumEngines.filter((e) => (e.badge || 0) <= 5), [premiumEngines]);
  const midPremium = useMemo(() => premiumEngines.filter((e) => (e.badge || 0) >= 6 && (e.badge || 0) <= 7), [premiumEngines]);
  const flagshipPremium = useMemo(() => premiumEngines.filter((e) => (e.badge || 0) >= 8), [premiumEngines]);

  // Smart recommendation based on user preferences
  const recommendedEngine = useMemo(() => {
    // If user hasn't used premium much, recommend mid-tier
    if (!prefs.explicitMode) {
      return budgetPremium[0] || null;
    }
    // For spicy users, recommend cookie or saffron (great balance)
    if (prefs.spiceLevel === "spicy" && prefs.roleplayStyle === "narrative") {
      return ROLEPLAY_ENGINES.find((e) => e.id === "cookie") || null;
    }
    if (prefs.spiceLevel === "spicy" && prefs.roleplayStyle === "slow_burn") {
      return ROLEPLAY_ENGINES.find((e) => e.id === "saffron") || null;
    }
    // For explicit intense, recommend cayenne
    if (prefs.spiceLevel === "explicit" && prefs.roleplayStyle === "intense") {
      return ROLEPLAY_ENGINES.find((e) => e.id === "cayenne") || null;
    }
    // Default to rosemary (best seller)
    return ROLEPLAY_ENGINES.find((e) => e.id === "rosemary") || null;
  }, [prefs, budgetPremium]);

  if (!open) return null;

  function selectEngine(engine: RoleplayEngine) {
    const next = applyEngine(engine);
    onApply(next, engine.id);
    setFineTuneEngineId(engine.id);
  }

  function patchPrefs(patch: Partial<RoleplayPreferences>, engineId: RoleplayEngineId) {
    const next = { ...prefs, ...patch };
    onApply(next, engineId);
  }
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal aria-labelledby="engine-picker-title">
      <button
        type="button"
        className="absolute inset-0 bg-ink/70 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close engine picker"
      />
      <div className="relative w-full max-w-md h-full bg-plum-deep border-l border-parchment/10 shadow-2xl flex flex-col engine-sheet">
        <header className="shrink-0 px-5 pt-5 pb-3 border-b border-parchment/10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="engine-picker-title" className="font-display text-lg">
                Choose your experience
              </h2>
              <p className="text-xs text-parchment/50 mt-1">
                Active: {activeEngineLabel(prefs, engineId)} · Premium engines unlock at 18+
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-parchment/50 hover:text-gold text-sm px-2 py-1 rounded focus-ring"
            >
              Done
            </button>
          </div>
          <div className="mt-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-gold/10 border border-violet-400/25 px-3 py-2.5 flex items-start gap-2 text-xs text-parchment/90">
            <span className="text-base leading-none">💎</span>
            <div>
              <p className="font-medium text-parchment mb-0.5">All engines included — no paywalls</p>
              <p className="text-parchment/60">Start free, upgrade your vibe. Higher badges = richer, more immersive experiences.</p>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {engineId === "custom" && (
            <p className="text-xs text-parchment/50 px-1">
              Custom mix active — pick a preset or use the sliders on any engine to fine-tune.
            </p>
          )}

          <section>
            <h3 className="text-xs font-medium text-parchment/45 uppercase tracking-wider mb-3">Free</h3>
            <div className="space-y-2">
              {freeEngines.map((engine) => (
                <EngineCard
                  key={engine.id}
                  engine={engine}
                  selected={engineId === engine.id}
                  fineTuneOpen={fineTuneEngineId === engine.id}
                  onSelect={() => selectEngine(engine)}
                  onToggleFineTune={() => {
                    if (engineId !== engine.id) selectEngine(engine);
                    setFineTuneEngineId((id) => (id === engine.id ? null : engine.id));
                  }}
                  prefs={prefs}
                  onPatch={patchPrefs}
                />
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-parchment/45 uppercase tracking-wider">Premium</h3>
              <span className="text-[10px] text-rose/80 border border-rose/30 rounded-full px-2 py-0.5">Explicit</span>
            </div>

            {/* Smart Recommendation */}
            {engineId === "custom" ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-[11px] font-medium text-gold uppercase tracking-wider">💡 Recommended for you</h4>
                </div>
                {recommendedEngine && (
                  <div className="space-y-2">
                    <EngineCard
                      engine={recommendedEngine}
                      selected={false}
                      fineTuneOpen={fineTuneEngineId === recommendedEngine.id}
                      onSelect={() => selectEngine(recommendedEngine)}
                      onToggleFineTune={() => {
                        selectEngine(recommendedEngine);
                        setFineTuneEngineId((id) => (id === recommendedEngine.id ? null : recommendedEngine.id));
                      }}
                      prefs={prefs}
                      onPatch={patchPrefs}
                    />
                    <p className="text-[10px] text-parchment/50 italic pl-1">
                      Based on your preferences — {recommendedEngine.description.toLowerCase()}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Budget Premium - Entry Level */}
                {budgetPremium.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[11px] font-medium text-emerald-400/80 uppercase tracking-wider">Entry Level</h4>
                      <span className="text-[10px] text-emerald-400/60">Great value</span>
                    </div>
                    <div className="space-y-2">
                      {budgetPremium.map((engine) => (
                        <EngineCard
                          key={engine.id}
                          engine={engine}
                          selected={engineId === engine.id}
                          fineTuneOpen={fineTuneEngineId === engine.id}
                          onSelect={() => selectEngine(engine)}
                          onToggleFineTune={() => {
                            if (engineId !== engine.id) selectEngine(engine);
                            setFineTuneEngineId((id) => (id === engine.id ? null : engine.id));
                          }}
                          prefs={prefs}
                          onPatch={patchPrefs}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Mid Premium - Popular Choices */}
                {midPremium.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[11px] font-medium text-gold/80 uppercase tracking-wider">Most Popular</h4>
                      <span className="text-[10px] text-gold/60">⭐ Great quality</span>
                    </div>
                    <div className="space-y-2">
                      {midPremium.map((engine) => (
                        <EngineCard
                          key={engine.id}
                          engine={engine}
                          selected={engineId === engine.id}
                          fineTuneOpen={fineTuneEngineId === engine.id}
                          onSelect={() => selectEngine(engine)}
                          onToggleFineTune={() => {
                            if (engineId !== engine.id) selectEngine(engine);
                            setFineTuneEngineId((id) => (id === engine.id ? null : engine.id));
                          }}
                          prefs={prefs}
                          onPatch={patchPrefs}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Flagship Premium - Best of the Best */}
                {flagshipPremium.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h4 className="text-[11px] font-medium text-violet-300 uppercase tracking-wider">🏆 Ultimate Experience</h4>
                      <span className="text-[10px] text-violet-300/80">Worth every penny</span>
                    </div>
                    <div className="space-y-2">
                      {flagshipPremium.map((engine) => (
                        <EngineCard
                          key={engine.id}
                          engine={engine}
                          selected={engineId === engine.id}
                          fineTuneOpen={fineTuneEngineId === engine.id}
                          onSelect={() => selectEngine(engine)}
                          onToggleFineTune={() => {
                            if (engineId !== engine.id) selectEngine(engine);
                            setFineTuneEngineId((id) => (id === engine.id ? null : engine.id));
                          }}
                          prefs={prefs}
                          onPatch={patchPrefs}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>

          {canSteerScene && (
            <section className="pb-4">
              <h3 className="text-xs font-medium text-parchment/45 uppercase tracking-wider mb-2">Steer scene</h3>
              <div className="flex flex-wrap gap-2">
                {SCENE_STEERS.map(({ label, directive }) => (
                  <button
                    key={label}
                    type="button"
                    disabled={steering}
                    onClick={() => {
                      onSteerScene(directive);
                      onClose();
                    }}
                    className="text-xs rounded-full px-3 py-1.5 border border-parchment/15 text-parchment/70 hover:border-rose/40 hover:text-gold focus-ring disabled:opacity-40"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
