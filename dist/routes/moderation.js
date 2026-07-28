"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const asyncHandler_1 = require("../lib/asyncHandler");
const db_1 = require("../lib/db");
const auth_1 = require("../lib/auth");
const admin_1 = require("../lib/admin");
const rateLimit_1 = require("../lib/rateLimit");
const router = (0, express_1.Router)();
// A character auto-hides from Discover once it collects this many open
// reports, pending an admin's decision — better to pull something out of
// view too eagerly than to leave a genuinely bad card up while it waits in
// a queue nobody's looked at yet.
const AUTO_HIDE_THRESHOLD = 3;
const VALID_REASONS = new Set([
    "harassment_or_hate",
    "impersonates_real_person",
    "sexual_content_not_marked_explicit",
    "spam_or_scam",
    "other",
]);
// POST /api/characters/:id/report — any signed-in user can report a public
// character card. Reporting your own character is a no-op error, and you
// can't file the same report twice.
router.post("/characters/:id/report", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId)
        return res.status(401).json({ error: "Not signed in." });
    const limit = (0, rateLimit_1.checkRateLimit)(`report:${userId}`, 20, 60 * 60);
    if (limit.limited) {
        res.set("Retry-After", String(limit.retryAfterSeconds));
        return res.status(429).json({ error: "Too many reports filed recently. Please slow down." });
    }
    const character = await db_1.prisma.character.findUnique({ where: { id: req.params.id } });
    if (!character || !character.isPublic) {
        return res.status(404).json({ error: "That character isn't available to report." });
    }
    if (character.ownerId === userId) {
        return res.status(400).json({ error: "You can't report your own character." });
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim().slice(0, 500) : "";
    if (!VALID_REASONS.has(reason)) {
        return res.status(400).json({ error: "Choose a valid report reason." });
    }
    const alreadyReported = await db_1.prisma.report.findFirst({
        where: { characterId: character.id, reporterId: userId, status: "open" },
    });
    if (alreadyReported) {
        return res.json({ ok: true, message: "You've already reported this character — it's in the review queue." });
    }
    await db_1.prisma.report.create({ data: { characterId: character.id, reporterId: userId, reason, note } });
    const openCount = await db_1.prisma.report.count({ where: { characterId: character.id, status: "open" } });
    await db_1.prisma.character.update({
        where: { id: character.id },
        data: {
            flagCount: openCount,
            isHidden: openCount >= AUTO_HIDE_THRESHOLD ? true : character.isHidden,
        },
    });
    return res.json({ ok: true, message: "Thanks — this has been sent to the review queue." });
}));
async function requireAdmin(req, res) {
    const userId = await (0, auth_1.getCurrentUserId)(req);
    if (!userId) {
        res.status(401).json({ error: "Not signed in." });
        return null;
    }
    const user = await db_1.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!(0, admin_1.isAdminEmail)(user?.email)) {
        res.status(403).json({ error: "Admin access required." });
        return null;
    }
    return userId;
}
// GET /api/admin/reports — open reports, grouped implicitly by character
// (each row is one report; a character with 3 reports appears 3 times, which
// is fine for a small review queue and lets an admin dismiss reports
// individually).
router.get("/admin/reports", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!(await requireAdmin(req, res)))
        return;
    const reports = await db_1.prisma.report.findMany({
        where: { status: "open" },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
            character: { select: { id: true, name: true, tagline: true, isHidden: true, ownerId: true } },
            reporter: { select: { displayName: true, email: true } },
        },
    });
    return res.json({ reports });
}));
// POST /api/admin/reports/:id/resolve  { action: "dismiss" | "hide" | "delete" }
router.post("/admin/reports/:id/resolve", (0, asyncHandler_1.asyncHandler)(async (req, res) => {
    if (!(await requireAdmin(req, res)))
        return;
    const report = await db_1.prisma.report.findUnique({ where: { id: req.params.id } });
    if (!report)
        return res.status(404).json({ error: "Report not found." });
    const action = req.body?.action;
    if (!["dismiss", "hide", "delete"].includes(action)) {
        return res.status(400).json({ error: "action must be dismiss, hide, or delete." });
    }
    if (action === "dismiss") {
        await db_1.prisma.report.update({ where: { id: report.id }, data: { status: "dismissed" } });
        const stillOpen = await db_1.prisma.report.count({ where: { characterId: report.characterId, status: "open" } });
        await db_1.prisma.character.update({
            where: { id: report.characterId },
            data: { flagCount: stillOpen, isHidden: stillOpen >= AUTO_HIDE_THRESHOLD },
        });
    }
    else if (action === "hide") {
        await db_1.prisma.report.updateMany({ where: { characterId: report.characterId, status: "open" }, data: { status: "upheld" } });
        await db_1.prisma.character.update({ where: { id: report.characterId }, data: { isHidden: true, isPublic: false } });
    }
    else {
        // delete — the character (and its reports, cascading) is removed outright.
        await db_1.prisma.character.delete({ where: { id: report.characterId } }).catch(() => {
            // already deleted by the owner in the meantime — nothing left to do.
        });
    }
    return res.json({ ok: true });
}));
exports.default = router;
