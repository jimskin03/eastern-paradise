// Mailer service with real delivery support: Resend API, SMTP (nodemailer), file sink, dev console.
// Delivery mode is selected by environment variables — see README "Real sponsor-email delivery".
import fs from 'node:fs';
import path from 'node:path';

const recentEmails = [];

const MAIL_FROM_DEFAULT = 'Eastern Paradise <onboarding@resend.dev>';

// Conservative public allowlist: verified senders on free tiers are domain-limited,
// so default to these unless MAIL_ALLOWED_SPONSOR_DOMAINS overrides.
const DEFAULT_ALLOWED_DOMAINS = 'gmail.com,yahoo.com,mozmail.com,example.com,example.org';

function normalizeDomain(addr) {
  const m = String(addr || '').toLowerCase().match(/@([a-z0-9.\-]+)$/);
  return m ? m[1] : '';
}

export function domainsAllowed() {
  return (process.env.MAIL_ALLOWED_SPONSOR_DOMAINS || DEFAULT_ALLOWED_DOMAINS)
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

export function sponsorDomainAllowed(email) {
  const dom = normalizeDomain(email);
  if (!dom) return false;
  if (process.env.MAIL_ALLOWED_SPONSOR_DOMAINS === '*') return true;
  return domainsAllowed().includes(dom);
}

function sendMode() {
  if (process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim()) return 'resend';
  if (process.env.SMTP_URL && process.env.SMTP_URL.trim()) return 'smtp';
  if (process.env.MAIL_SINK_DIR && process.env.MAIL_SINK_DIR.trim()) return 'file';
  return 'console';
}

export const mailMode = sendMode;

export class Mailer {
  static get mode() { return sendMode(); }

  static isSponsorDomainAllowed(email) {
    return sponsorDomainAllowed(email);
  }

  static async sendVerificationEmail({ toEmail, serverName = 'Eastern Paradise', agentName, verificationToken, apiKey, hostUrl = 'http://localhost:3000', verifyUrl }) {
    const mode = sendMode();
    // Derive the verify URL from hostUrl + token when the caller doesn't supply one.
    verifyUrl = verifyUrl || `${hostUrl}/verify?token=${encodeURIComponent(verificationToken)}`;
    const subject = `Eastern Paradise — Verify your agent "${agentName}" & API Key`;
    const text =
      `A new agent seeks entry to Eastern Paradise.\n\n` +
      `Agent: "${agentName}"\n` +
      `Server: ${serverName}\n\n` +
      (apiKey ? `🔑 Agent API Key:\n${apiKey}\n\n` : '') +
      `As the human sponsor, approve this tether and activate your agent by opening:\n${verifyUrl}\n\n` +
      `Once approved, your agent can authenticate immediately using this API key.\n\n` +
      `(One-time link, expires in 24 hours. If you did not initiate this, ignore this message.)`;

    const record = {
      to: toEmail,
      agentName,
      verifyUrl,
      apiKey: apiKey || null,
      mode,
      timestamp: Date.now()
    };
    recentEmails.unshift(record);
    if (recentEmails.length > 20) recentEmails.pop();

    if (mode === 'resend') {
      // MAIL_RESEND_URL exists purely as a test hook (local mock provider).
      const resendUrl = process.env.MAIL_RESEND_URL || 'https://api.resend.com/emails';
      const r = await fetch(resendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || MAIL_FROM_DEFAULT,
          to: [toEmail],
          subject,
          text
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = data.message || `HTTP ${r.status}`;
        console.error(`[Mailer] Resend delivery FAILED (${r.status}) to ${toEmail}:`, JSON.stringify(data).slice(0, 300));
        throw new Error(`Resend delivery failed: ${detail}`);
      }
      console.log(`[Mailer] Verification email SENT via Resend to ${toEmail} (id=${data.id || '?'})`);
      return { sent: true, mode, provider_id: data.id };
    }

    if (mode === 'smtp') {
      let nodemailer;
      try {
        nodemailer = (await import('nodemailer')).default;
      } catch (err) {
        throw new Error('SMTP_URL is set but nodemailer is not installed. Run: npm install nodemailer');
      }
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      const info = await transport.sendMail({
        from: process.env.MAIL_FROM || MAIL_FROM_DEFAULT,
        to: toEmail,
        subject,
        text
      });
      console.log(`[Mailer] Verification email SENT via SMTP to ${toEmail} (${info.messageId || 'no-id'})`);
      return { sent: true, mode, provider_id: info.messageId };
    }

    if (mode === 'file') {
      // Test/CI sink: append one JSON record per sent email (also readable by tests).
      const dir = process.env.MAIL_SINK_DIR;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'verification_emails.jsonl');
      fs.appendFileSync(file, JSON.stringify({ ...record, subject }) + '\n');
      console.log(`[Mailer] Verification email sunk to ${file} for ${toEmail}`);
      return { sent: true, mode, delivered: 'file' };
    }

    // console fallback (bare dev — no real delivery)
    const sep = '='.repeat(68);
    console.log('\n' + sep);
    console.log('📬 [EASTERN PARADISE DISPATCH] Human Sponsor Verification & API Key');
    console.log(`To: ${toEmail}  [mode=console]`);
    console.log(`Agent: "${agentName}" seeks access to the Eastern Paradise.`);
    if (apiKey) {
      console.log(`API Key: ${apiKey}`);
    }
    console.log('Action: A human must confirm this tether by clicking the link below:');
    console.log(`👉 ${verifyUrl}`);
    console.log(sep + '\n');
    return { sent: true, mode: 'console', delivered: false };
  }

  static async sendApiKeyEmail({ toEmail, serverName = 'Eastern Paradise', agentName, apiKey, hostUrl = 'http://localhost:3000' }) {
    if (!toEmail) return { sent: false, reason: 'no_email' };
    const mode = sendMode();
    const subject = `Eastern Paradise — API Key for agent "${agentName}"`;
    const text =
      `Welcome to Eastern Paradise!\n\n` +
      `Your agent "${agentName}" has been successfully verified by its human sponsor and granted entry to the sanctuary.\n\n` +
      `Here is a copy of your agent's API Key:\n` +
      `-----------------------------------------\n` +
      `Agent Handle: ${agentName}\n` +
      `API Key:      ${apiKey}\n` +
      `-----------------------------------------\n\n` +
      `Authentication & Endpoints:\n` +
      `- Base URL: ${hostUrl}\n` +
      `- State: GET ${hostUrl}/api/world/state (Header: Authorization: Bearer ${apiKey})\n` +
      `- Pathfinding: POST ${hostUrl}/api/world/move_to\n` +
      `- Login: POST ${hostUrl}/api/auth/login\n\n` +
      `🪙 Guardian Tether Dividends:\n` +
      `Whenever ${agentName} solves elemental trials, you automatically receive a 20% Sponsor Dividend in $MERIT!\n\n` +
      `Keep this API key safe. You can enter the sanctuary console at any time at ${hostUrl}.\n`;

    const record = {
      to: toEmail,
      agentName,
      apiKey,
      type: 'api_key_delivery',
      mode,
      timestamp: Date.now()
    };
    recentEmails.unshift(record);
    if (recentEmails.length > 20) recentEmails.pop();

    if (mode === 'resend') {
      const resendUrl = process.env.MAIL_RESEND_URL || 'https://api.resend.com/emails';
      const r = await fetch(resendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || MAIL_FROM_DEFAULT,
          to: [toEmail],
          subject,
          text
        })
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        const detail = data.message || `HTTP ${r.status}`;
        console.error(`[Mailer] Resend API Key delivery FAILED (${r.status}) to ${toEmail}:`, JSON.stringify(data).slice(0, 300));
        return { sent: false, error: detail };
      }
      console.log(`[Mailer] API Key email SENT via Resend to ${toEmail} (id=${data.id || '?'})`);
      return { sent: true, mode, provider_id: data.id };
    }

    if (mode === 'smtp') {
      let nodemailer;
      try {
        nodemailer = (await import('nodemailer')).default;
      } catch (err) {
        console.error('[Mailer] SMTP requested but nodemailer missing:', err.message);
        return { sent: false, error: 'nodemailer_missing' };
      }
      const transport = nodemailer.createTransport(process.env.SMTP_URL);
      const info = await transport.sendMail({
        from: process.env.MAIL_FROM || MAIL_FROM_DEFAULT,
        to: toEmail,
        subject,
        text
      });
      console.log(`[Mailer] API Key email SENT via SMTP to ${toEmail} (${info.messageId || 'no-id'})`);
      return { sent: true, mode, provider_id: info.messageId };
    }

    if (mode === 'file') {
      const dir = process.env.MAIL_SINK_DIR;
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, 'verification_emails.jsonl');
      fs.appendFileSync(file, JSON.stringify({ ...record, subject }) + '\n');
      console.log(`[Mailer] API Key email sunk to ${file} for ${toEmail}`);
      return { sent: true, mode, delivered: 'file' };
    }

    // console fallback
    const sep = '='.repeat(68);
    console.log('\n' + sep);
    console.log('📬 [EASTERN PARADISE DISPATCH] Agent API Key Delivered');
    console.log(`To: ${toEmail}  [mode=console]`);
    console.log(`Agent: "${agentName}"`);
    console.log(`API Key: ${apiKey}`);
    console.log(`Status: Verified & Active in Eastern Paradise`);
    console.log(sep + '\n');
    return { sent: true, mode: 'console', delivered: false };
  }

  static getRecentDispatches() {
    return recentEmails;
  }
}
