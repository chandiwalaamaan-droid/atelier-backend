/**
 * Public "Sign in with Google" OAuth 2.0 Client ID (type "Web application"),
 * from Google Cloud Console > APIs & Services > Credentials. Client IDs are
 * not secret — safe to ship in frontend JS — but you must add this site's
 * origin(s) (Netlify URL + any preview URLs) under "Authorized JavaScript
 * origins" on that same credential, or the button will fail to render/verify.
 * Set in the Netlify dashboard (Site configuration > Environment variables);
 * see netlify.toml for the full note.
 */
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

type GoogleCredentialResponse = { credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const SCRIPT_SRC = "https://accounts.google.com/gsi/client";

let scriptPromise: Promise<void> | null = null;

/** Loads Google Identity Services exactly once, however many times this is called. */
export function loadGoogleScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Sign-In can only run in the browser."));
  }
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Couldn't load Google Sign-In."));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}
