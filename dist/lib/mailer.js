"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendMail = sendMail;
const nodemailer_1 = __importDefault(require("nodemailer"));
// Email is optional infrastructure: if SMTP_* env vars aren't set (e.g. in
// local dev, or a deploy that hasn't wired up a provider yet), we fall back
// to logging the message to the console instead of throwing. That keeps the
// password-reset / verification flows testable end-to-end without a real
// mail provider, while doing the right thing in production once SMTP_HOST
// etc. are configured (any SMTP provider works: Postmark, SES, Resend's SMTP
// endpoint, Mailgun, plain Gmail app password, ...).
let transporter = null;
function getTransporter() {
    if (transporter)
        return transporter;
    const host = process.env.SMTP_HOST;
    if (!host)
        return null;
    transporter = nodemailer_1.default.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
    });
    return transporter;
}
async function sendMail(to, subject, html, text) {
    const t = getTransporter();
    const from = process.env.MAIL_FROM || "Atelier <no-reply@atelier.local>";
    if (!t) {
        // Dev fallback — no SMTP configured. Print the email so whoever's
        // testing locally can grab the link out of the server logs.
        console.log(`\n[mailer] SMTP not configured — printing email instead of sending.`);
        console.log(`[mailer] To: ${to}\n[mailer] Subject: ${subject}\n[mailer] ${text}\n`);
        return { delivered: false };
    }
    await t.sendMail({ from, to, subject, html, text });
    return { delivered: true };
}
