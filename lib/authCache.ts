import { apiFetch } from "@/lib/api";

/**
 * Module-scope cache for "am I signed in?" (see components/RequireAuth.tsx).
 *
 * Previously every page re-mounted RequireAuth, which re-fetched
 * /api/auth/me and blocked the whole page behind a "Loading…" screen on
 * every navigation — even seconds after the previous page had already
 * confirmed the session. Across a Netlify (frontend) <-> Render (backend)
 * cross-origin hop, that round trip is slow enough to make the whole app
 * feel sluggish just from clicking between pages.
 *
 * This cache lives for the lifetime of the tab (reset on full reload) and
 * lets RequireAuth render children immediately if we checked recently,
 * while still revalidating in the background so an expired/logged-out
 * session is still caught quickly.
 */

type AuthUser = { id: string; email: string; displayName: string } | null;

let cachedUser: AuthUser | undefined; // undefined = never checked yet this session
let cachedAt = 0;
let inFlight: Promise<AuthUser> | null = null;

const FRESH_MS = 60_000; // treat a check younger than this as still valid, no refetch needed

async function fetchUser(): Promise<AuthUser> {
  try {
    const res = await apiFetch("/api/auth/me");
    const data = await res.json().catch(() => ({}));
    return data.user ?? null;
  } catch {
    return null;
  }
}

/** Returns the cached user (if fresh) without hitting the network. */
export function getCachedUser(): { user: AuthUser; fresh: boolean } | null {
  if (cachedUser === undefined) return null;
  return { user: cachedUser, fresh: Date.now() - cachedAt < FRESH_MS };
}

/** Fetches (or reuses an in-flight fetch of) the current user, and updates the cache. */
export async function fetchAndCacheUser(): Promise<AuthUser> {
  if (inFlight) return inFlight;
  inFlight = fetchUser().then((user) => {
    cachedUser = user;
    cachedAt = Date.now();
    inFlight = null;
    return user;
  });
  return inFlight;
}

/** Called on login/logout so the very next page navigation reflects it immediately. */
export function setCachedUser(user: AuthUser) {
  cachedUser = user;
  cachedAt = Date.now();
}

export function clearAuthCache() {
  cachedUser = undefined;
  cachedAt = 0;
}
