# RoliChat Backend

Node.js + TypeScript backend for RoliChat.

## Required project files

- `src/` — API, auth, chat, provider, billing, image and job logic.
- `prisma/` — Prisma schema, migration history and production seed script.
- `anime-characters-with-assets.ts` — anime seed character data used by `prisma/seed.ts`.
- `sfw-premium-characters-with-assets.ts` — SFW seed character data used by `prisma/seed.ts`.
- `prisma/explicit-characters.json` — 18+ seed character data used by `prisma/seed.ts`.
- `package.json` / `package-lock.json` — dependencies and scripts.
- `render.yaml` — Render deployment configuration.
- `.env.example` — environment-variable template.
- `tests/` — regression tests for chat behavior and provider logic.

## Local setup

```bash
npm ci
npx prisma generate
npm run build
npm test
```

For local development:

```bash
npm run dev
```

## Database

Apply committed migrations:

```bash
npx prisma migrate deploy
```

Seed/update bundled characters:

```bash
npm run db:seed
```

## Production

The included `render.yaml` installs dependencies, applies Prisma migrations, seeds character data, builds TypeScript, and starts `dist/server.js`.

Copy values from `.env.example` into your deployment environment; do not commit real secrets or API keys.
