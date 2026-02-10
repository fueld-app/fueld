import nodemailer from 'nodemailer';

type InviteEmailPayload = {
  to: string;
  inviteLink: string;
  invitedByName: string;
  role: string;
};

function getSmtpConfig() {
  const host = process.env['SMTP_HOST'];
  const port = Number(process.env['SMTP_PORT'] ?? '587');
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const from = process.env['SMTP_FROM'];
  const secure = String(process.env['SMTP_SECURE'] ?? 'false') === 'true';

  if (!host || !user || !pass || !from) return null;

  return { host, port, user, pass, from, secure };
}

function getTransporter() {
  const cfg = getSmtpConfig();
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
  const cfg = getSmtpConfig();
  if (!cfg) {
    console.warn('[Email] SMTP not configured, invite email skipped');
    return false;
  }

  const transporter = getTransporter();
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
