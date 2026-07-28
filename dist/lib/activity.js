"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.touchActivity = touchActivity;
const db_1 = require("./db");
// Called on every authenticated request (see lib/auth.ts:getCurrentUserId).
// Writing lastActiveAt on literally every request would hammer the DB, so we
// keep an in-memory "already touched recently" cache per process and only
// write once per user per TOUCH_INTERVAL_MS. This is fire-and-forget: it must
// never slow down or fail the request it's attached to.
const TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const recentlyTouched = new Map();
function touchActivity(userId) {
    const now = Date.now();
    const last = recentlyTouched.get(userId);
    if (last && now - last < TOUCH_INTERVAL_MS)
        return;
    recentlyTouched.set(userId, now);
    // Also clears deletionWarningSentAt: if a warned user comes back before
    // the deletion sweep runs, they've un-flagged themselves.
    db_1.prisma.user
        .update({
        where: { id: userId },
        data: { lastActiveAt: new Date(), deletionWarningSentAt: null },
    })
        .catch((err) => {
        console.error("[activity] failed to touch lastActiveAt", err);
    });
}
