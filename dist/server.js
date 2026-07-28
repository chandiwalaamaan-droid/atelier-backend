"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const node_cron_1 = __importDefault(require("node-cron"));
const retentionCleanup_1 = require("./jobs/retentionCleanup");
const auth_1 = __importDefault(require("./routes/auth"));
const characters_1 = __importDefault(require("./routes/characters"));
const avatar_1 = __importDefault(require("./routes/avatar"));
const chat_1 = __importDefault(require("./routes/chat"));
const health_1 = __importDefault(require("./routes/health"));
const moderation_1 = __importDefault(require("./routes/moderation"));
const billing_1 = __importStar(require("./routes/billing"));
const app = (0, express_1.default)();
// The frontend (Netlify) is a different origin from this API (Render), so
// CORS must explicitly allow it and echo credentials for the cross-site
// session cookie (see lib/auth.ts) to be sent/received by the browser.
// FRONTEND_URL supports a comma-separated list (e.g. your Netlify prod URL
// plus deploy-preview URLs) if you need more than one allowed origin.
const allowedOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
app.use((0, cors_1.default)({
    origin(origin, callback) {
        // Allow no-origin requests (curl, server-to-server health checks).
        if (!origin || allowedOrigins.includes(origin))
            return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
}));
app.use((0, cookie_parser_1.default)());
// Razorpay webhook signature verification needs the exact raw request
// bytes, so this one route is registered with express.raw() ahead of the
// global express.json() below — parsing it as JSON first would leave
// nothing for the signature check to hash. See routes/billing.ts for the
// verification logic (a no-op response until PAYMENTS_ENABLED is set).
app.post("/api/billing/webhook", express_1.default.raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["x-razorpay-signature"];
    const result = await (0, billing_1.handleWebhook)(req.body, typeof signature === "string" ? signature : undefined);
    res.sendStatus(result.status);
});
app.use(express_1.default.json({ limit: "2mb" }));
// Avatar images (uploaded or AI-generated) are hosted on Cloudinary — see
// src/lib/cloudinary.ts — so there's no local-disk uploads folder to serve
// and no persistent disk needed on Render.
app.use("/api/health", health_1.default);
app.use("/api/auth", auth_1.default);
app.use("/api/characters", characters_1.default);
app.use("/api/characters", avatar_1.default);
app.use("/api/chat", chat_1.default);
app.use("/api", moderation_1.default);
app.use("/api/billing", billing_1.default);
app.use((err, _req, res, _next) => {
    console.error(err);
    if (res.headersSent)
        return;
    res.status(500).json({ error: "Something went wrong." });
});
const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
    console.log(`[atelier-backend] listening on :${PORT}`);
});
// Daily sweep: warns users ~11 months inactive, anonymizes accounts inactive
// a full year. Runs at 03:00 UTC (~8:30 AM IST) — low-traffic window.
// See src/jobs/retentionCleanup.ts for the actual policy.
if (process.env.DISABLE_RETENTION_CRON !== "true") {
    node_cron_1.default.schedule("0 3 * * *", () => {
        (0, retentionCleanup_1.runRetentionCleanup)().catch((err) => {
            console.error("[retention] cleanup run failed", err);
        });
    });
}
