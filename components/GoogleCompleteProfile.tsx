"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { setAuthToken } from "@/lib/authToken";

/**
 * Shown right after Google Sign-In reports isNewUser: true. Rolichat requires
 * a self-reported date of birth and ToS acceptance at signup (18+ content
 * gate) — Google doesn't give us either, so this collects them before
 * POSTing to /api/auth/google/complete to actually create the account.
 */
export function GoogleCompleteProfile({
  credential,
  suggestedDisplayName,
  onDone,
}: {
  credential: string;
  suggestedDisplayName: string;
  onDone: () => void;
}) {
  const [displayName, setDisplayName] = useState(suggestedDisplayName);
  const [birthdate, setBirthdate] = useState("");
  const [tosAccepted, setTosAccepted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!tosAccepted) {
      setError("You must confirm you're 18+ and accept the Terms of Service to continue.");
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/google/complete", {
        method: "POST",
        body: JSON.stringify({ credential, displayName, birthdate, tosAccepted }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Something went wrong.");
        return;
      }
      setAuthToken(data.token);
      onDone();
    } catch {
      // fetch() itself threw — without this the button was stuck on
      // "Creating account…" forever with no feedback.
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <p className="text-sm text-parchment/60 mb-6">One more step — this finishes setting up your account.</p>

      {error && (
        <p className="mb-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded px-3 py-2">{error}</p>
      )}

      <label className="block text-sm mb-1 text-parchment/70">Display name</label>
      <input
        required
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        className="w-full mb-4 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
      />

      <label className="block text-sm mb-1 text-parchment/70">Date of birth</label>
      <input
        type="date"
        required
        value={birthdate}
        onChange={(e) => setBirthdate(e.target.value)}
        max={new Date().toISOString().slice(0, 10)}
        className="w-full mb-2 rounded-lg bg-plum-deep border border-parchment/20 px-3 py-2 focus-ring"
      />
      <p className="text-xs text-parchment/50 mb-4">
        Rolichat includes user-created mature content and is for adults only. You must be 18 or older.
      </p>

      <label className="flex items-start gap-2 mb-6 text-xs text-parchment/70 cursor-pointer">
        <input
          type="checkbox"
          required
          checked={tosAccepted}
          onChange={(e) => setTosAccepted(e.target.checked)}
          className="mt-0.5 focus-ring"
        />
        <span>
          I'm 18 or older and I agree to the{" "}
          <Link href="/terms" target="_blank" className="text-gold hover:underline">
            Terms of Service &amp; Content Policy
          </Link>{" "}
          and{" "}
          <Link href="/privacy" target="_blank" className="text-gold hover:underline">
            Privacy Policy
          </Link>
          .
        </span>
      </label>

      <button
        type="submit"
        disabled={loading || !tosAccepted}
        className="w-full bg-gold text-ink py-2.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-60"
      >
        {loading ? "Creating account…" : "Finish creating account"}
      </button>
    </form>
  );
}
