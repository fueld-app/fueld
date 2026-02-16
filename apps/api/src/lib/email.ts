import nodemailer from 'nodemailer';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { integrationCredentials } from '../db/schema';
import { decrypt } from './crypto';

type InviteEmailPayload = {
  to: string;
  inviteLink: string;
  invitedByName: string;
  role: string;
};

type PasswordResetEmailPayload = {
  to: string;
  resetLink: string;
  requestedByName?: string;
};

type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

function getSmtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env['SMTP_HOST'];
  const port = Number(process.env['SMTP_PORT'] ?? '587');
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const from = process.env['SMTP_FROM'];
  const secure = String(process.env['SMTP_SECURE'] ?? 'false') === 'true';

  if (!host || !user || !pass || !from) return null;

  return { host, port, user, pass, from, secure };
}

async function getSmtpConfigFromDb(): Promise<SmtpConfig | null> {
  try {
    const rows = await db
      .select({
        key: integrationCredentials.key,
        encryptedValue: integrationCredentials.encryptedValue,
        iv: integrationCredentials.iv,
        authTag: integrationCredentials.authTag,
      })
      .from(integrationCredentials)
      .where(and(
        eq(integrationCredentials.provider, 'SMTP'),
      ));

    if (!rows.length) return null;

    const values = new Map<string, string>();
    for (const row of rows) {
      values.set(row.key, decrypt(row.encryptedValue, row.iv, row.authTag));
    }

    const host = values.get('host');
    const port = Number(values.get('port') ?? '587');
    const user = values.get('user');
    const pass = values.get('pass');
    const from = values.get('from');
    const secure = (values.get('secure') ?? 'false') === 'true';

    if (!host || !user || !pass || !from) return null;

    return { host, port, user, pass, from, secure };
  } catch (err: any) {
    console.warn('[Email] Failed to load SMTP config from DB:', err?.message ?? err);
    return null;
  }
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const dbCfg = await getSmtpConfigFromDb();
  if (dbCfg) return dbCfg;
  return getSmtpConfigFromEnv();
}

async function getTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg) return null;

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
}

export async function sendInviteEmail(payload: InviteEmailPayload): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    console.warn('[Email] SMTP not configured, invite email skipped');
    return false;
  }

  const transporter = await getTransporter();
  if (!transporter) return false;

  const subject = 'You have been invited to Fueld';
  const text =
    `Hi,\n\n` +
    `${payload.invitedByName} invited you to Fueld as ${payload.role}.\n\n` +
    `Complete your signup here:\n${payload.inviteLink}\n\n` +
    `If you did not expect this invite, you can ignore this email.\n`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <h2 style="margin: 0 0 12px;">You are invited to Fueld</h2>
      <p style="margin: 0 0 12px;">
        <strong>${payload.invitedByName}</strong> invited you to Fueld as <strong>${payload.role}</strong>.
      </p>
      <p style="margin: 0 0 16px;">Click below to complete your signup:</p>
      <p style="margin: 0 0 24px;">
        <a href="${payload.inviteLink}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">
          Accept invite
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">If you did not expect this invite, you can ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: payload.to,
    subject,
    text,
    html,
  });

  return true;
}

export async function sendPasswordResetEmail(payload: PasswordResetEmailPayload): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    console.warn('[Email] SMTP not configured, password reset email skipped');
    return false;
  }

  const transporter = await getTransporter();
  if (!transporter) return false;

  const requestedBy = payload.requestedByName ? ` (requested by ${payload.requestedByName})` : '';
  const subject = `Password reset for your Fueld account${requestedBy}`;
  const text =
    `Hi,\n\n` +
    `A password reset was requested for your Fueld account${requestedBy}.\n\n` +
    `Reset your password here:\n${payload.resetLink}\n\n` +
    `If you did not request this, you can ignore this email.\n`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1f2937;">
      <h2 style="margin: 0 0 12px;">Reset your Fueld password</h2>
      <p style="margin: 0 0 12px;">A password reset was requested for your Fueld account${requestedBy}.</p>
      <p style="margin: 0 0 16px;">Click below to set a new password:</p>
      <p style="margin: 0 0 24px;">
        <a href="${payload.resetLink}" style="display: inline-block; padding: 10px 16px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">
          Reset password
        </a>
      </p>
      <p style="margin: 0; font-size: 12px; color: #6b7280;">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  await transporter.sendMail({
    from: cfg.from,
    to: payload.to,
    subject,
    text,
    html,
  });

  return true;
}

export async function sendTestEmail(to: string): Promise<boolean> {
  const cfg = await getSmtpConfig();
  if (!cfg) {
    console.warn('[Email] SMTP not configured, test email skipped');
    return false;
  }

  const transporter = await getTransporter();
  if (!transporter) return false;

  const subject = 'Fueld SMTP test';
  const text = 'This is a test email from Fueld.';
  const html = '<p>This is a test email from <strong>Fueld</strong>.</p>';

  await transporter.sendMail({
    from: cfg.from,
    to,
    subject,
    text,
    html,
  });

  return true;
}
