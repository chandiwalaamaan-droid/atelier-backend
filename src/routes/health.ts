import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler";
import { prisma } from "../lib/db";
import { listAvailableProviders } from "../lib/providers";
import { getNvidiaKeys } from "../lib/providers/nvidia";

const router = Router();

// Cheap health check for Render's healthCheckPath and for an UptimeRobot (or
// similar) keep-warm ping. Checks the DB connection and reports whether any
// chat provider is currently configured/reachable, without triggering any
// circuit breaker state — this never calls a provider, just checks isAvailable().
router.get("/", asyncHandler(async (_req, res) => {
  const startedAt = Date.now();

  let dbOk = true;
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbOk = false;
    console.error("[health] database check failed:", err);
  }

  const providers = await listAvailableProviders();
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

// -----------------------------------------------------------------------
// TEMPORARY diagnostic route — safe to delete once you've picked a
// working NVIDIA_MODEL. Not linked from anywhere in the app; requires
// knowing one of your own NVIDIA_API_KEY* values as a query param, so it
// isn't a meaningful new attack surface even though it's unauthenticated
// in the normal session sense. Calls NVIDIA's own /v1/models with that
// key and returns the live, current list of models your account can
// actually call — the only source of truth, since the public catalog
// pages and third-party trackers lag actual availability by weeks.
//
// Usage: GET /health/nvidia-models?key=YOUR_NVIDIA_API_KEY
router.get("/nvidia-models", asyncHandler(async (req, res) => {
  const providedKey = typeof req.query.key === "string" ? req.query.key : "";
  const validKeys = getNvidiaKeys().map((k) => k.key);
  if (!providedKey || !validKeys.includes(providedKey)) {
    // 404, not 401/403 — don't confirm this route does anything to a
    // caller who doesn't already have a valid key.
    return res.status(404).json({ error: "Not found" });
  }

  const upstream = await fetch("https://integrate.api.nvidia.com/v1/models", {
    headers: { Authorization: `Bearer ${providedKey}` },
  });
  const body = await upstream.json().catch(() => null);
  if (!upstream.ok || !body) {
    return res.status(502).json({ error: "Failed to fetch model list from NVIDIA", status: upstream.status, body });
  }

  const ids = Array.isArray(body?.data) ? body.data.map((m: { id?: string }) => m.id).filter(Boolean).sort() : [];
  return res.json({ count: ids.length, models: ids });
}));

export default router;
