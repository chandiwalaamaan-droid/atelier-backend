# Atelier — backend (Express API, deploy to Render)

[![CI](https://github.com/chandiwalaamaan-droid/atelier-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/chandiwalaamaan-droid/atelier-backend/actions/workflows/ci.yml)

This is the API half of Atelier, split out from the original combined Next.js
app so the frontend can be deployed separately on Netlify. It's a plain
Express + TypeScript app — no Next.js in here at all.

Handles: auth (signup/login/logout, JWT session cookie), character CRUD,
avatar upload + free AI generation (Pollinations.ai, no key needed), and the
streaming chat endpoint with the free-provider fallback chain
(Groq → SambaNova → NVIDIA → Cloudflare → Ollama).

## Why split like this

The original app was one Next.js project serving both pages and `/api/*`
routes from the same origin. Splitting it means:

- **Frontend** (Next.js) → **Netlify**
- **Backend** (this folder, Express) → **Render**, which also gives it a
  persistent disk for avatar image uploads (Netlify has no such thing, and
  Vercel's serverless functions have an ephemeral filesystem — Render is the
  right fit here, same as it was for the original combined app).

Since the frontend and backend now live on different domains, a few things
changed from the original single-app version:

- The session cookie is now `SameSite=None; Secure` (was `Lax`) so it can be
  sent cross-site between the Netlify and Render domains. Every deploy target
  here is HTTPS, so this is safe.
- CORS is configured via `FRONTEND_URL`, with credentials enabled, so the
  browser will actually store/send that cookie.
- The old `middleware.ts` edge auth check (which read the cookie directly)
  is gone — the frontend now asks this API "am I signed in?" via
  `/api/auth/me` instead. See `components/RequireAuth.tsx` in the frontend.

Everything else — the provider fallback chain, circuit breakers, rate
limiting, Prisma schema, memory summarization — is carried over unchanged
from the original app.

## Local setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `DATABASE_URL` — a CockroachDB Serverless connection string (get one free
     at cockroachlabs.cloud; 10 GiB free storage). Any Postgres-wire-compatible
     connection string works since `prisma/schema.prisma` uses the `cockroachdb`
     provider — swap it back to `postgresql` if you'd rather point at plain
     Postgres or local SQLite for dev.
   - `FRONTEND_URL` — `http://localhost:3000` for local frontend dev
   - `SESSION_SECRET` — any long random string
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` — optional.
     Powers password-reset, email-verification, and inactivity-warning
     messages (see `src/jobs/retentionCleanup.ts`). If unset, those emails are
     printed to the server console instead of sent, so the flows still work
     end-to-end in local dev without a mail provider.
   - `ADMIN_EMAILS` — comma-separated list of account emails allowed to hit
     `/api/admin/reports*` (the Discover moderation queue). Leave unset to
     disable admin access entirely.
   - Whichever chat provider key(s) you're using (all optional individually,
     but you need at least one, or Ollama running locally)
   - `PAYMENTS_ENABLED`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
     `RAZORPAY_WEBHOOK_SECRET` — optional, for the Razorpay billing scaffold
     (spark packs + Atelier+ membership checkout). Everything in
     `src/routes/billing.ts` 503s unless `PAYMENTS_ENABLED=true` — leave it
     unset/`false` for now. See `src/lib/payments/razorpay.ts` for what's
     needed to actually go live later.
   - `DISABLE_RETENTION_CRON` — set to `true` locally if you don't want the
     daily inactivity-cleanup job (see below) running while you develop.
3. `npx prisma migrate dev --name init` — creates the schema on your database
4. `npm run dev` — starts the API on `http://localhost:4000`

### Inactive-account cleanup

A daily job (`src/jobs/retentionCleanup.ts`, scheduled in `src/server.ts` via
`node-cron`) emails users who've been inactive ~11 months, then anonymizes
accounts inactive a full year: their characters, chats, and tokens are
deleted, and their `User` row is scrubbed (email/name/password) rather than
deleted outright, so the linked `PaymentOrder` (Razorpay) history stays intact
for tax/audit purposes. `lastActiveAt` is bumped automatically on any
authenticated request (debounced to once per 6h per user — see
`src/lib/activity.ts`).

## Deploying to Render

1. Push this folder to its own GitHub repo (or a subfolder Render can point
   at with a custom root directory).
2. In the Render dashboard: **New → Blueprint**, point it at this repo.
   Render reads `render.yaml` and provisions the web service and a 1GB
   persistent disk for avatar uploads. The database is *not* provisioned by
   Render — create a free CockroachDB Serverless cluster at
   cockroachlabs.cloud and paste its connection string into `DATABASE_URL`
   under the service's Environment tab (`render.yaml` leaves it as
   `sync: false` for exactly this).
3. Fill in the secrets Render prompts for: `FRONTEND_URL` (your Netlify site
   URL, once you have it — you can update this after deploying the frontend),
   plus whichever `GROQ_API_KEY` / `NVIDIA_API_KEY` / etc. you're using.
4. Deploy. Note the resulting `https://your-service.onrender.com` URL — the
   frontend needs it as `NEXT_PUBLIC_API_URL`.
5. Once the frontend is deployed and you have its Netlify URL, come back and
   set `FRONTEND_URL` on this service to that URL (comma-separated if you
   also want to allow Netlify deploy-preview URLs), then redeploy.

## How it fits together

- `src/server.ts` — Express app setup: CORS, cookies, static `/uploads`, routes
- `src/routes/auth.ts` — register / login / logout / me
- `src/routes/characters.ts` — character CRUD
- `src/routes/avatar.ts` — image upload (multer) + free AI-generated avatar (Pollinations.ai)
- `src/routes/chat.ts` — streaming chat, conversation reset, memory summarization
- `src/routes/health.ts` — health check for Render + uptime pings
- `src/routes/billing.ts` — Razorpay checkout order creation, payment verification, webhook (dormant until `PAYMENTS_ENABLED=true`)
- `src/lib/payments/razorpay.ts` — Razorpay SDK wrapper, signature verification, server-side pricing catalog
- `src/lib/auth.ts` — JWT session cookie creation/verification (cross-site config)
- `src/lib/db.ts` — Prisma client
- `src/lib/rateLimit.ts` — in-memory rate limiter for login/signup/chat
- `src/lib/providers/` — NVIDIA, SambaNova, Groq, Cloudflare (chat), Ollama clients + fallback orchestrator
- `prisma/schema.prisma` — `User`, `Character`, `Message` tables (unchanged)

## Turning on billing (Razorpay) later

The billing routes, schema (`User.sparkBalance` / `membershipTier`, the
`PaymentOrder` table), and frontend checkout flow are all wired up already
but inert — `PAYMENTS_ENABLED` defaults to off, and every route in
`src/routes/billing.ts` 503s until it's explicitly turned on. To go live:

1. Create a Razorpay account and get your live (or test) `Key ID` / `Key
   Secret` from the Razorpay dashboard.
2. Set on this service: `PAYMENTS_ENABLED=true`, `RAZORPAY_KEY_ID`,
   `RAZORPAY_KEY_SECRET`.
3. Optional but recommended: in the Razorpay dashboard, add a webhook
   pointed at `https://your-backend/api/billing/webhook` (event:
   `payment.captured`), then set `RAZORPAY_WEBHOOK_SECRET` here to the
   secret shown for that webhook. This is a resilience backstop for
   payments whose browser tab closes/drops before it can call `/verify`
   itself — the common in-browser path works without it.
4. Review the placeholder INR prices in `src/lib/payments/razorpay.ts`
   (`SPARK_PACK_PRICES`, `MEMBERSHIP_MONTHLY_PAISE`) — they're a rough,
   unrounded carry-over from the frontend's display-only USD prices, not
   real pricing.
5. On the frontend: set `NEXT_PUBLIC_RAZORPAY_KEY_ID` (same public Key ID,
   safe to expose client-side) and flip `PREMIUM_PAYMENTS_ENABLED` to
   `true` in `lib/premium.ts` so the buy/subscribe buttons become
   clickable.
6. Redeploy both services, then run an end-to-end test payment (Razorpay's
   test mode/test cards) before switching to live keys.
