"use client";

import { useEffect, useRef, useState } from "react";
import { GOOGLE_CLIENT_ID, loadGoogleScript } from "@/lib/googleAuth";

/**
 * Renders Google's own "Continue with Google" / "Sign up with Google"
 * button (not a custom-styled one — Google's Identity Services requires
 * their button for the credential flow to fire reliably, and using their
 * exact button is part of Google's brand guidelines). We do theme it to fit
 * the site: filled_black + pill shape line up with Rolichat's dark cards and
 * rounded-full gold buttons.
 *
 * `onCredential(idTokenJwt)` fires once the user picks a Google account —
 * the caller POSTs it to /api/auth/google (see login/signup pages).
 */
export function GoogleSignInButton({
  text,
  onCredential,
}: {
  text: "signin_with" | "signup_with";
  onCredential: (credential: string) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return; // not configured yet — skip quietly, password form still works
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (response) => onCredentialRef.current(response.credential),
        });
        // Fixed pixel width, not percentage — GIS doesn't support responsive
        // sizing natively, so measure the actual container instead of guessing.
        // Measuring wrapperRef (not containerRef) matters: containerRef starts
        // as display:none until `ready`, and getBoundingClientRect() on a
        // display:none element always returns 0 — which used to silently
        // fall back to a hardcoded 320px and overflow on any narrower phone.
        // wrapperRef is never hidden, so it always reports the real width.
        const measuredWidth = Math.round(wrapperRef.current?.getBoundingClientRect().width || 0) || 320;
        window.google.accounts.id.renderButton(containerRef.current, {
          theme: "filled_black",
          shape: "pill",
          size: "large",
          text,
          width: Math.min(Math.max(measuredWidth, 200), 400),
        });
        setReady(true);
      })
      .catch(() => {
        // GIS blocked (ad-blocker, slow network, offline) — fail quietly,
        // the email/password form still works fine without it.
      });

    return () => {
      cancelled = true;
    };
  }, [text]);

  if (!GOOGLE_CLIENT_ID) return null;

  return (
    <div ref={wrapperRef}>
      <div
        ref={containerRef}
        className="flex justify-center"
        style={{ display: ready ? "flex" : "none", colorScheme: "light" }}
      />
      {ready && (
        <div className="flex items-center gap-3 my-5 text-xs text-parchment/40" aria-hidden="true">
          <div className="flex-1 h-px bg-parchment/15" />
          <span>or</span>
          <div className="flex-1 h-px bg-parchment/15" />
        </div>
      )}
    </div>
  );
}
