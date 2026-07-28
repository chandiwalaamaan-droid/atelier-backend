"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asyncHandler_1 = require("../lib/asyncHandler");
const db_1 = require("../lib/db");
const providers_1 = require("../lib/providers");
const router = (0, express_1.Router)();
// Cheap health check for Render's healthCheckPath and for an UptimeRobot (or
// similar) keep-warm ping. Checks the DB connection and reports whether any
// chat provider is currently configured/reachable, without triggering any
// circuit breaker state — this never calls a provider, just checks isAvailable().
router.get("/", (0, asyncHandler_1.asyncHandler)(async (_req, res) => {
    const startedAt = Date.now();
    let dbOk = true;
    try {
        await db_1.prisma.$queryRaw `SELECT 1`;
    }
    catch (err) {
        dbOk = false;
        console.error("[health] database check failed:", err);
    }
    const providers = await (0, providers_1.listAvailableProviders)();
    const ok = dbOk;
    // This endpoint is public and unauthenticated, so it must never name which
    // backend(s) power chat — only whether chat can currently be served at all.
    return res.status(ok ? 200 : 503).json({
        ok,
        database: dbOk ? "up" : "down",
        chatAvailable: providers.length > 0,
        checkedInMs: Date.now() - startedAt,
    });
}));
exports.default = router;
