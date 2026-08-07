"use client";

import { useState } from "react";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      setMessage(data.message || "If that email has an account, a reset link is on its way.");
      setSent(true);
    } catch {
      setError("Couldn't reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-6 bg-void relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[400px] h-[400px] rounded-full opacity-[0.03] pointer-events-none" style={{ background: "radial-gradient(circle, #c9a227 0%, transparent 70%)" }} aria-hidden />
      <div className="absolute bottom-[-20%] right-[-10%] w-[400px] h-[400px] rounded-full opacity-[0.03] pointer-events-none" style={{ background: "radial-gradient(circle, #b5657a 0%, transparent 70%)" }} aria-hidden />

      <form onSubmit={onSubmit} className="relative w-full max-w-sm rounded-2xl bg-gradient-to-br from-plum/60 to-plum-deep/80 p-8 border border-white/5 shadow-2xl animate-scale-in">
        <div className="text-center mb-6">
          <span className="text-3xl mb-2 block">🔑</span>
          <h1 className="font-display text-2xl gradient-text">Reset your password</h1>
          <p className="text-sm text-parchment/50 mt-1">
            Enter the email you signed up with and we'll send a reset link.
          </p>
        </div>

        {error && (
          <p className="mb-4 text-sm text-rose bg-rose/10 border border-rose/30 rounded-lg px-3 py-2">{error}</p>
        )}
        {sent && (
          <p className="mb-4 text-sm text-parchment/80 bg-gold/10 border border-gold/30 rounded-lg px-3 py-2">
            {message}
          </p>
        )}

        {!sent && (
          <>
            <label className="block text-sm mb-1.5 text-parchment/60">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full mb-6 rounded-xl bg-plum-deep/80 border border-white/10 px-4 py-2.5 focus-ring placeholder:text-parchment/25"
              placeholder="you@example.com"
            />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gold text-ink py-2.5 rounded-full font-medium hover:brightness-110 focus-ring disabled:opacity-60 btn-shine shadow-lg shadow-gold/20"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
          </>
        )}

        <p className="mt-5 text-sm text-parchment/50 text-center">
          <Link href="/login" className="text-gold hover:text-gold/80 transition-colors font-medium">
            Back to log in
          </Link>
        </p>
      </form>
    </main>
  );
}