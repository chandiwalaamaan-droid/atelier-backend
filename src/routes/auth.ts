import crypto from "crypto";
import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
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

// "Sign in with Google" (Google Identity Services). Client ID is not secret
// (it's shipped in the frontend bundle too) — no client secret is needed
// for this flow, since we only ever verify an ID token's signature against
// Google's public keys, we never exchange an auth code ourselves.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

async function verifyGoogleCredential(credential: string) {
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const payload = ticket.getPayload();
  if (!payload) throw new Error("Empty Google token payload");
  return payload;
}

// Shared by /register and /google/complete — both need the same 18+ /
// display-name / ToS checks before a User row can be created.
function validateNewAccountFields(displayName: string, birthdateRaw: string, tosAccepted: boolean) {
  if (!displayName) return { error: "Enter a display name." };
  const birthdate = birthdateRaw ? new Date(birthdateRaw) : null;
  if (!birthdate || Number.isNaN(birthdate.getTime())) return { error: "Enter your date of birth." };
  if (birthdate.getTime() > Date.now()) return { error: "That date of birth is in the future." };
  if (calculateAge(birthdate) < MINIMUM_AGE_YEARS) return { error: "You must be 18 or older to use Atelier." };
  if (!tosAccepted) return { error: "You must accept the Terms of Service and Content Policy to continue." };
  return { birthdate };
}

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
    token,
  });
}));

// POST /api/auth/google — "Continue with Google" for an existing account
// (found by a previously-linked googleId, or by matching email — Google has
// already verified that email, so it's safe to link it to a password
// account with the same address). If no account exists yet, we deliberately
// do NOT create one here: Atelier requires a self-reported date of birth
// and ToS acceptance at signup (18+ content gate), neither of which Google
// gives us. Instead this responds with isNewUser so the frontend can show a
// short "finish your profile" step that posts to /google/complete.
router.post("/google", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`google-auth:${ip}`, 20, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }

  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google Sign-In isn't configured on this server yet." });
  }

  const credential = typeof req.body?.credential === "string" ? req.body.credential : "";
  if (!credential) return res.status(400).json({ error: "Missing Google credential." });

  let payload;
  try {
    payload = await verifyGoogleCredential(credential);
  } catch (err) {
    console.error("[auth] Google credential verification failed:", err);
    return res.status(401).json({ error: "Invalid Google sign-in token." });
  }
  if (!payload.email_verified) {
    return res.status(401).json({
      error: "Your Google account's email isn't verified. Please verify it with Google first.",
    });
  }

  const googleId = payload.sub;
  const email = (payload.email || "").toLowerCase();

  let user = await prisma.user.findUnique({ where: { googleId } });
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId, emailVerified: true },
      });
    }
  }

  if (!user) {
    return res.json({
      isNewUser: true,
      email,
      suggestedDisplayName: typeof payload.name === "string" ? payload.name : "",
    });
  }

  const token = await createSessionToken(user.id);
  setSessionCookie(res, token);
  return res.json({
    isNewUser: false,
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    token,
  });
}));

// POST /api/auth/google/complete — finishes account creation for a Google
// sign-in that came back isNewUser from /google above. Re-verifies the same
// credential (it's still valid for a few minutes and re-verification is
// cheap/stateless) rather than trusting the email the frontend sends back,
// so the account is created from Google's claims, not client input.
router.post("/google/complete", asyncHandler(async (req, res) => {
  const ip = getClientIp(req);
  const limit = checkRateLimit(`google-complete:${ip}`, 10, 60 * 60);
  if (limit.limited) {
    res.set("Retry-After", String(limit.retryAfterSeconds));
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }

  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: "Google Sign-In isn't configured on this server yet." });
  }

  const credential = typeof req.body?.credential === "string" ? req.body.credential : "";
  if (!credential) return res.status(400).json({ error: "Missing Google credential." });

  let payload;
  try {
    payload = await verifyGoogleCredential(credential);
  } catch (err) {
    console.error("[auth] Google credential verification failed:", err);
    return res.status(401).json({ error: "Invalid Google sign-in token." });
  }
  if (!payload.email_verified) {
    return res.status(401).json({
      error: "Your Google account's email isn't verified. Please verify it with Google first.",
    });
  }

  const body = req.body ?? {};
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  const birthdateRaw = typeof body.birthdate === "string" ? body.birthdate : "";
  const tosAccepted = body.tosAccepted === true;

  const validation = validateNewAccountFields(displayName, birthdateRaw, tosAccepted);
  if ("error" in validation) return res.status(400).json({ error: validation.error });

  const googleId = payload.sub;
  const email = (payload.email || "").toLowerCase();

  // Race guard: this Google account (or its email) may have been linked by
  // a concurrent /google or /google/complete call since the frontend first
  // asked. Reuse that account instead of creating a duplicate.
  let user = await prisma.user.findUnique({ where: { googleId } });
  if (!user) {
    const existingByEmail = await prisma.user.findUnique({ where: { email } });
    if (existingByEmail) {
      user = await prisma.user.update({
        where: { id: existingByEmail.id },
        data: { googleId, emailVerified: true },
      });
    }
  }

  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          email,
          // Random secret, never revealed — satisfies passwordHash's NOT
          // NULL constraint and keeps the password-login form from ever
          // working against this account (it's Google-only until/unless
          // they later set a password via "forgot password").
          passwordHash: await hashPassword(crypto.randomBytes(32).toString("hex")),
          displayName,
          birthdate: validation.birthdate,
          tosAcceptedAt: new Date(),
          googleId,
          // Google has already verified this address, so there's no need
          // to send our own verification email for it.
          emailVerified: true,
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      throw err;
    }
  }

  const token = await createSessionToken(user.id);
  setSessionCookie(res, token);
  return res.json({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
    token,
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

  return res.json({ id: user.id, email: user.email, displayName: user.displayName, token });
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
