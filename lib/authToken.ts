/**
 * Fallback session storage for mobile browsers that block the cross-site
 * SameSite=None cookie the backend sets (iOS Safari's "Prevent Cross-Site
 * Tracking" — on by default — and many in-app browsers drop third-party
 * cookies like this one entirely, even though SameSite=None; Secure is
 * exactly the config a cross-origin cookie is supposed to need).
 *
 * Every login/register/google auth response from the backend already
 * includes the session `token` in its JSON body for this reason (see
 * backend's getTokenFromRequest, which checks Authorization: Bearer as a
 * fallback if there's no cookie) — this was just never being used on the
 * frontend. We store it in localStorage (survives reloads and reopening
 * the app, not just the current tab) and apiFetch attaches it as a Bearer
 * header on every request, alongside the cookie attempt. Wherever the
 * cookie works, both are sent and the cookie is what the backend checks
 * first; wherever the cookie was dropped, this header carries the session.
 */
const STORAGE_KEY = "rolichat_session_token";

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage disabled (private mode with storage blocked, etc.) — cookie
    // auth still works wherever the cookie itself isn't being blocked.
    return null;
  }
}

export function setAuthToken(token: string | null | undefined) {
  if (typeof window === "undefined") return;
  try {
    if (token) {
      window.localStorage.setItem(STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore — same fallback reasoning as getAuthToken above.
  }
}

export function clearAuthToken() {
  setAuthToken(null);
}
