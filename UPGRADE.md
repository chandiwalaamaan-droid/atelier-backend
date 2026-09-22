> **Latest patch: natural character dialogue.** See `NATURAL_REPLIES.md`. Redeploy the backend only for this patch; keep your current mobile-fixed frontend. No database changes are required. Original Story Edition notes follow.

# Rolichat — Story Edition

This is an upgrade of your existing Next.js frontend and Express backend. Keep your current accounts, database, provider keys, character data, and deployment configuration.

## What changed

- New editorial landing page with existing character artwork, gentle CSS motion, clear calls to action, and interactive illustrative scene previews. The landing route no longer imports the frame sequence, canvas, or Three.js hero.
- Discovery now has recent conversations, saved favorites, a Fantasy filter, Surprise me, incremental card rendering, lazy-loaded portraits, working broken-image fallbacks, and a recoverable load-error state.
- Start a story creates a private character copy using the existing remix API. Favorites are saved per account in the current browser. The mature discovery switch starts off each visit.
- New Scene director in chat: your fictional name and role, current setting, writing tone, boundaries, and four editable starter scenes. These settings are sent with each generation and stay on this browser for this account/character.
- Draft messages survive refresh. Chat search highlights matching messages. Continue advances the scene without fabricating a user message. The chat toolbar exposes memory and scene settings directly.
- More readable conversation surfaces, mobile bottom navigation, reduced-motion support, and onboarding that explains actual features.
- Streaming fixes: partial control markers are buffered, heartbeat events never enter dialogue, provider fallback clears the previous stream's buffers, and visual updates are capped around 25 fps while typing.
- Retry requests carry a stable request ID. The backend reuses a persisted user turn or replays its completed reply instead of inserting the user message again.
- Regeneration replaces a reply in place. A save failure cannot delete the old reply. Failed delete/reset requests keep the displayed history intact.
- Corrected send/edit/regenerate busy guards, IME Enter handling, failed chat loading, and false “verified” labels. Exports include the story setting and use your persona name.

Existing character creation, memory editing, model selection, voice playback, authentication, moderation, account management, and billing scaffolding remain part of the app. Scene previews on the landing page are examples, not live AI responses.

## Update your existing deployments

1. Replace the source in your backend repository with the contents of `atelier-backend-main` from the backend ZIP. Preserve the deployment's existing environment variables.
2. Build the backend with `npm ci` then `npm run build`; start with `npm start`. Deploy this backend before the frontend.
3. Replace the source in your frontend repository with the contents of `atelier-frontend-main` from this ZIP.
4. Keep `NEXT_PUBLIC_API_URL` on Netlify set to your Render backend origin, with no `/api` suffix. Keep `FRONTEND_URL` on Render set to your frontend origin.
5. Build the frontend with `npm ci` then `npm run build`. The existing `netlify.toml` remains in place.
6. After deployment, check sign-in, discovery, a new chat, stop/retry, memory, and voice using your real services.

This update changes no Prisma schema. Do not reset or reseed your production database to install it. These are source ZIPs, not a static HTML export; use your existing Git-connected Next.js deployment.

## Local development

Use the existing backend database/provider configuration. `.env.example` files are included as minimal setup guides. Backend: `npm ci`, then `npm run dev` (port 4000). Frontend: `npm ci`, then `npm run dev` (port 3000).

## Verification

- Frontend production build and TypeScript checks.
- Backend TypeScript build.
- Chromium browser checks at 1440px desktop and 390px mobile: navigation, illustrative previews, saved favorites, genre filters, scene settings, persistent drafts, sending, search, failed resets, and discovery retry. No page errors or horizontal overflow in those checks. Browser checks used simulated API responses.
- `npm test` in the frontend: framing at every network split, malformed events, and corrupt/blocked local storage.
- `npm test` in the backend: route-level tests with simulated database/provider dependencies for duplicate retries, failed generation, request identity, regeneration save failure, overlapping requests, ownership, and bounded story input.

No real provider responses, payments, email delivery, hosted database, or live production deployment were exercised. AI response quality still depends on your configured model and service availability.

## Storage and scaling

Favorites, drafts, and scene settings are browser-local, scoped by account and character; they do not sync across devices. Messages and conversation memory use your existing database. Story direction is a model instruction, not a guarantee of model behavior.

The generation guard is per backend process. Persisted request IDs prevent duplicate user rows on retries, but multiple server replicas need a shared distributed conversation lock for complete cross-instance ordering. Keep a single API instance until that is implemented. Existing database and provider capacity limits still apply.

## Main files

Frontend: `app/page.tsx`, `app/explore/page.tsx`, `app/chat/[characterId]/page.tsx`, `app/globals.css`, `components/StoryDirector.tsx`, `components/ExploreCharacterCard.tsx`, `components/AppShell.tsx`, `components/WelcomeOnboarding.tsx`, `lib/chatStream.ts`, `lib/storySettings.ts`, and the regression tests.

Backend: `src/routes/chat.ts`, `src/lib/storyContext.ts`, and `tests/chat.test.cjs`.
