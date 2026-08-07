"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const [status, setStatus] = useState<"loading" | "ok" | "error">(token ? "loading" : "error");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch("/api/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "That link is invalid or has expired.");
          setStatus("error");
          return;
        }
        setStatus("ok");
      })
      .catch(() => {
        setError("Couldn't reach the server.");
        setStatus("error");
      });
  }, [token]);

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="stitched w-full max-w-sm rounded-2xl bg-plum/60 p-8 text-center">
        {status === "loading" && (
          <>
            <h1 className="font-display text-2xl mb-2">Verifying…</h1>
            <p className="text-sm text-parchment/60">One moment.</p>
          </>
        )}
        {status === "ok" && (
          <>
            <h1 className="font-display text-2xl mb-2">Email verified</h1>
            <p className="text-sm text-parchment/60 mb-6">
              You're all set. You can now share characters to Discover.
            </p>
            <Link href="/dashboard" className="text-gold hover:underline text-sm">
              Go to your dashboard
            </Link>
          </>
        )}
        {status === "error" && (
          <>
            <h1 className="font-display text-2xl mb-2">Couldn't verify</h1>
            <p className="text-sm text-parchment/60 mb-6">{error || "That link is invalid or has expired."}</p>
            <Link href="/dashboard" className="text-gold hover:underline text-sm">
              Back to dashboard
            </Link>
          </>
        )}
      </div>
    </main>
  );
}
