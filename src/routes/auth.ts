import crypto from "crypto";
import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/db";
import {
  hashPassword,
  verifyPassword,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getCurrentUserId,
} from "../lib/auth";
import { checkRateLimit, getClientIp } from "../lib/rateLimit";
import { sendMail } from "../lib/mailer";

const router = Router();

const MINIMUM_AGE_YEARS = 18;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

function calculateAge(birthdate: Date, now = new Date()): number {
  let age = now.getFullYear() - birthdate.getFullYear();
  const monthDiff = now.getMonth() - birthdate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthdate.getDate())) {
    age--;
  }
  return age;
}

async function issueEmailVerification(userId: string, email: string, frontendUrl: string) {
  const raw = issueRawToken();
  await prisma.emailVerificationToken.create({
    data: { userId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS) },
  });
  const link = `${frontendUrl}/verify-email?token=${raw}`;
  await sendMail(
    email,
    "Verify your Atelier email",
    `<p>Confirm this is your email address to finish setting up your Atelier account.</p><p><a href="${link}">${link}</a></p><p>This link expires in 24 hours.</p>`,
    `Verify your email: ${link} (expires in 24 hours)`
  );
}

router.post("/register", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`register:${ip}`, 5, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many signups from this network. Please try again later." });
  }

  const body = req.body ?? {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const birthdateRaw = typeof body.birthdate === "string" ? body.birthdate : "";
  const tosAccepted = body.tosAccepted === true;

  if (!email || !email.includes("@")) {
    return res.status(400).json({ error: "Enter a valid email." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters." });
  }
  if (!displayName) {
    return res.status(400).json({ error: "Enter a display name." });
  }

  const birthdate = birthdateRaw ? new Date(birthdateRaw) : null;
  if (!birthdate || Number.isNaN(birthdate.getTime())) {
    return res.status(400).json({ error: "Enter your date of birth." });
  }
  if (birthdate.getTime() > Date.now()) {
    return res.status(400).json({ error: "That date of birth is in the future." });
  }
  if (calculateAge(birthdate) < MINIMUM_AGE_YEARS) {
    return res.status(403).json({ error: "You must be 18 or older to use Atelier." });
  }
  if (!tosAccepted) {
    return res.status(400).json({ error: "You must accept the Terms of Service and Content Policy to continue." });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "An account with that email already exists." });
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({
      data: { email, passwordHash, displayName, birthdate, tosAcceptedAt: new Date() },
    });
  } catch (err: any) {
    // Race with the findUnique check above — the DB's unique constraint is
    // the real guard; P2002 means someone else's signup won the race.
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "An account with that email already exists." });
    }
    throw err;
  }

  const token = await createSessionToken(user.id);
  setSessionCookie(res, token);

  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim();
  issueEmailVerification(user.id, user.email, frontendUrl).catch((err) =>
    console.error("Failed to send verification email:", err)
  );

  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  });
}));

router.post("/login", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`login:${ip}`, 10, 15 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many login attempts. Please wait a few minutes and try again." });
  }

  const body = req.body ?? {};
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return res.status(400).json({ error: "Enter your email and password." });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Incorrect email or password." });
  }

  const token = await createSessionToken(user.id);
  setSessionCookie(res, token);

  return res.json({ id: user.id, email: user.email, displayName: user.displayName });
}));

router.post("/logout", asyncHandler(async (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
}));

router.get("/me", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.json({ user: null });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, displayName: true, emailVerified: true },
  });
  return res.json({ user });
}));

// POST /api/auth/forgot-password — always responds 200 with the same message
// whether or not the email exists, so this endpoint can't be used to
// enumerate registered accounts. If the account exists, emails a one-time
// reset link.
router.post("/forgot-password", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`forgot-password:${ip}`, 5, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const genericResponse = { ok: true, message: "If that email has an account, a reset link is on its way." };
  if (!email) return res.json(genericResponse);

  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const raw = issueRawToken();
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim();
    const link = `${frontendUrl}/reset-password?token=${raw}`;
    await sendMail(
      user.email,
      "Reset your Atelier password",
      `<p>Someone requested a password reset for this account. If that was you, set a new password:</p><p><a href="${link}">${link}</a></p><p>This link expires in 1 hour. If you didn't request this, you can ignore this email.</p>`,
      `Reset your password: ${link} (expires in 1 hour; ignore if you didn't request this)`
    ).catch((err) => console.error("Failed to send reset email:", err));
  }

  return res.json(genericResponse);
}));

// POST /api/auth/reset-password — consumes a token minted above and sets a
// new password. Tokens are single-use and short-lived.
router.post("/reset-password", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`reset-password:${ip}`, 10, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }

  const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!rawToken) return res.status(400).json({ error: "Missing reset token." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "That reset link is invalid or has expired. Request a new one." });
  }

  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  return res.json({ ok: true });
}));

// GET /api/auth/verify-email?token=... — confirms the email that was used
// to sign up. Not required to use the app, but required before a character
// can be shared to Discover (see routes/characters.ts).
router.post("/verify-email", asyncHandler(async (req, res) => {
  const rawToken = typeof req.body?.token === "string" ? req.body.token : "";
  if (!rawToken) return res.status(400).json({ error: "Missing verification token." });

  const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(rawToken) } });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    return res.status(400).json({ error: "That verification link is invalid or has expired." });
  }

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { emailVerified: true } }),
    prisma.emailVerificationToken.deleteMany({ where: { userId: record.userId } }),
  ]);

  return res.json({ ok: true });
}));

// POST /api/auth/resend-verification — for the signed-in user, re-sends the
// verification email (e.g. the first one expired or got lost).
router.post("/resend-verification", asyncHandler(async (req, res) => {
  const userId = await getCurrentUserId(req);
  if (!userId) return res.status(401).json({ error: "Not signed in." });

  const limit = checkRateLimit(`resend-verification:${userId}`, 3, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many requests. Please try again later." });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return res.status(404).json({ error: "Account not found." });
  if (user.emailVerified) return res.json({ ok: true, message: "Your email is already verified." });

  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim();
  await issueEmailVerification(user.id, user.email, frontendUrl);

  return res.json({ ok: true, message: "Verification email sent." });
}));

export default router;
