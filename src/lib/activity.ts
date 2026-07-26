import { prisma } from "./db";

// Called on every authenticated request (see lib/auth.ts:getCurrentUserId).
// Writing lastActiveAt on literally every request would hammer the DB, so we
// keep an in-memory "already touched recently" cache per process and only
// write once per user per TOUCH_INTERVAL_MS. This is fire-and-forget: it must
// never slow down or fail the request it's attached to.
const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const recentlyTouched = new Map<string, number>();

export function touchActivity(userId: string) {
  const now = Date.now();
  const last = recentlyTouched.get(userId);
  if (last && now - last < TOUCH_INTERVAL_MS) return;
  recentlyTouched.set(userId, now);

  // Also clears deletionWarningSentAt: if a warned user comes back before
  // the deletion sweep runs, they've un-flagged themselves.
  prisma.user
    .update({
      where: { id: userId },
      data: { lastActiveAt: new Date(), deletionWarningSentAt: null },
    })
    .catch((err: unknown) => {
      console.error("[activity] failed to touch lastActiveAt", err);
    });
}
