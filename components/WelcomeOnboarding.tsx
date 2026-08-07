"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "rolichat:welcome:v1";

type Props = {
  onDone?: () => void;
};

export default function WelcomeOnboarding({ onDone }: Props) {
  const [open, setOpen] = useState(false);
  const [gender, setGender] = useState<string | null>(null);
  const [ageRange, setAgeRange] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
    } catch {
      /* ignore */
    }
  }, []);

  function finish() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ gender, ageRange, at: Date.now() }));
    } catch {
      /* ignore */
    }
    setOpen(false);
    onDone?.();
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-md rounded-2xl bg-gradient-to-br from-surface-card to-surface-raised border border-white/10 p-6 shadow-2xl animate-scale-in">
        <div className="text-center mb-6">
          <span className="text-3xl block mb-2">✨</span>
          <p className="font-display text-xl gradient-text">Welcome to Rolichat!</p>
          <p className="text-sm text-parchment/55 mt-1">
            Tell us a little more for a better personalized experience.
          </p>
        </div>

        <p className="text-sm text-parchment/70 mb-3 text-center">Please select your gender:</p>
        <div className="flex justify-center gap-6 mb-6">
          {[
            { id: "male", label: "♂", title: "Male" },
            { id: "female", label: "♀", title: "Female" },
            { id: "other", label: "◯", title: "Other" },
          ].map(({ id, label, title }) => (
            <button
              key={id}
              type="button"
              title={title}
              onClick={() => setGender(id)}
              className={`w-14 h-14 rounded-full border-2 text-xl flex items-center justify-center focus-ring transition-all duration-200 ${
                gender === id ? "border-gold bg-gold/15 shadow-lg shadow-gold/10" : "border-white/15 hover:border-white/30 hover:bg-white/5"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <p className="text-sm text-parchment/70 mb-3 text-center">What's your age?</p>
        <div className="space-y-2 mb-6">
          {["18 - 25", "26 - 30", "Above 30"].map((range) => (
            <button
              key={range}
              type="button"
              onClick={() => setAgeRange(range)}
              className={`w-full py-3 rounded-xl border text-sm focus-ring transition-all duration-200 ${
                ageRange === range
                  ? "border-gold/50 bg-gold/10 text-parchment shadow-sm"
                  : "border-white/10 bg-surface-raised hover:border-white/20 text-parchment/80 hover:bg-white/5"
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={finish}
          disabled={!gender || !ageRange}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-gold/20 to-gold/10 border border-gold/30 font-medium hover:brightness-110 focus-ring disabled:opacity-40 transition-all"
        >
          Next
        </button>
        <button type="button" onClick={finish} className="w-full mt-2 py-2 text-xs text-parchment/40 hover:text-parchment/60 transition-colors">
          Skip for now
        </button>
      </div>
    </div>
  );
}