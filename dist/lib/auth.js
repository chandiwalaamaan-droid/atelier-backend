"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COOKIE_NAME = void 0;
exports.hashPassword = hashPassword;
exports.verifyPassword = verifyPassword;
exports.createSessionToken = createSessionToken;
exports.verifySessionToken = verifySessionToken;
exports.setSessionCookie = setSessionCookie;
exports.clearSessionCookie = clearSessionCookie;
exports.getCurrentUserId = getCurrentUserId;
const jose_1 = require("jose");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const activity_1 = require("./activity");
const db_1 = require("./db");
exports.COOKIE_NAME = "session";
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days
function getSecretKey() {
    const secret = process.env.SESSION_SECRET;
    if (!secret) {
        throw new Error("SESSION_SECRET is not set. Copy .env.example to .env and fill it in.");
    }
    return new TextEncoder().encode(secret);
}
async function hashPassword(password) {
    return bcryptjs_1.default.hash(password, 10);
}
async function verifyPassword(password, hash) {
    return bcryptjs_1.default.compare(password, hash);
}
async function createSessionToken(userId) {
    return new jose_1.SignJWT({ userId })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_DURATION_SECONDS}s`)
        .sign(getSecretKey());
}
async function verifySessionToken(token) {
    try {
        const { payload } = await (0, jose_1.jwtVerify)(token, getSecretKey());
        if (typeof payload.userId === "string") {
            return { userId: payload.userId };
        }
        return null;
    }
    catch {
        return null;
    }
}
// The frontend (Netlify) and backend (Render) live on different origins, so
// the session cookie must be sent cross-site. That requires SameSite=None
// (which in turn requires Secure) — browsers reject SameSite=None without
// Secure. Every deploy target here (Netlify + Render) is HTTPS, so this is
// safe. CORS on the Express app must also set credentials:true and echo back
// the exact frontend origin (see server.ts) for the cookie to actually be
// stored/sent by the browser.
function setSessionCookie(res, token) {
    res.cookie(exports.COOKIE_NAME, token, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        maxAge: SESSION_DURATION_SECONDS * 1000,
    });
}
function clearSessionCookie(res) {
    res.clearCookie(exports.COOKIE_NAME, {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
    });
}
async function getCurrentUserId(req) {
    const token = req.cookies?.[exports.COOKIE_NAME];
    if (!token)
        return null;
    const session = await verifySessionToken(token);
    if (!session?.userId)
        return null;
    // A session JWT can outlive the account it points to — it's valid for 30
    // days, but the retention job (src/jobs/retentionCleanup.ts) can anonymize
    // an account at any point in that window. Treat an anonymized/deleted
    // account as "not logged in" rather than trusting the token alone.
    const user = await db_1.prisma.user.findUnique({
        where: { id: session.userId },
        select: { deletedAt: true },
    });
    if (!user || user.deletedAt)
        return null;
    (0, activity_1.touchActivity)(session.userId);
    return session.userId;
}
