"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { getCachedUser, fetchAndCacheUser } from "@/lib/authCache";

/**
 * Replaces the old Next.js middleware.ts, which redirected unauthenticated
 * visitors to /login by reading the session cookie directly at the edge.
 * That only works when frontend and backend share an origin. Now that the
 * backend lives on a different domain (Render) than the frontend (Netlify),
 * the middleware can't read that cookie itself — so this component asks the
 * backend "am I signed in?" instead, and redirects if not.
 *
 * To avoid re-checking (and showing a full-page "Loading…" spinner) on
 * every single page navigation, this consults a short-lived shared cache
 * first (see lib/authCache.ts). If we verified the session within the last
 * minute, render immediately and just revalidate quietly in the
 * background — only a cold/never-checked session blocks on the network.
 */
export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const cached = getCachedUser();
  const [status, setStatus] = useState<"checking" | "ok">(cached?.user ? "ok" : "checking");

  useEffect(() => {
    let cancelled = false;

    // Already confirmed recently — render now, just quietly revalidate.
    if (cached?.user && cached.fresh) {
      fetchAndCacheUser().then((user) => {
        if (!cancelled && !user) router.replace(`/login?next=${encodeURIComponent(pathname || "/explore")}`);
      });
      return () => {
        cancelled = true;
      };
    }

    fetchAndCacheUser().then((user) => {
      if (cancelled) return;
      if (user) {
        setStatus("ok");
      } else {
        router.replace(`/login?next=${encodeURIComponent(pathname || "/explore")}`);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, pathname]);

  if (status === "checking") {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <p className="text-parchment/60">Loading…</p>
      </main>
    );
  }

  return <>{children}</>;
}
