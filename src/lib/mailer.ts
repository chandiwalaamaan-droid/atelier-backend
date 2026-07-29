import nodemailer from "nodemailer";

// Email is optional infrastructure: if SMTP_* env vars aren't set (e.g. in
// local dev, or a deploy that hasn't wired up a provider yet), we fall back
// to logging the message to the console instead of throwing. That keeps the
// password-reset / verification flows testable end-to-end without a real
// mail provider, while doing the right thing in production once SMTP_HOST
// etc. are configured (any SMTP provider works: Postmark, SES, Resend's SMTP
// endpoint, Mailgun, plain Gmail app password, ...).
let transporter: ReturnType<typeof nodemailer.createTransport> | null = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  if (!host) return null;

  transporter = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  return transporter;
}

export async function sendMail(to: string, subject: string, html: string, text: string) {
  const t = getTransporter();
  const from = process.env.MAIL_FROM || "Atelier <no-reply@atelier.local>";

  if (!t) {
    // Dev fallback — no SMTP configured. Print the email so whoever's
    // testing locally can grab the link out of the server logs.
    console.log(`\n[mailer] SMTP not configured — printing email instead of sending.`);
    console.log(`[mailer] To: ${to}\n[mailer] Subject: ${subject}\n[mailer] ${text}\n`);
    return { delivered: false as const };
  }

  await t.sendMail({ from, to, subject, html, text });
  return { delivered: true as const };
}
