import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { encrypt } from '../src/lib/crypto';
import { integrationCredentials } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type EmailModule = typeof import('../src/lib/email');
let emailModule: EmailModule;

const ORIGINAL_ENV = {
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_SECURE: process.env.SMTP_SECURE,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete (process.env as any)[k];
    else (process.env as any)[k] = v;
  }
}

function clearSmtpEnv() {
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_SECURE;
}

function setSmtpEnv(values: {
  host: string;
  port: string;
  user: string;
  pass: string;
  from: string;
  secure: 'true' | 'false';
}) {
  process.env.SMTP_HOST = values.host;
  process.env.SMTP_PORT = values.port;
  process.env.SMTP_USER = values.user;
  process.env.SMTP_PASS = values.pass;
  process.env.SMTP_FROM = values.from;
  process.env.SMTP_SECURE = values.secure;
}

let transportConfigs: Array<Record<string, unknown>> = [];
let sentMails: Array<Record<string, unknown>> = [];
let transporterDisabled = false;

async function seedDbSmtpConfig(
  tenantId: string,
  values: Partial<{
    host: string;
    port: string;
    user: string;
    pass: string;
    from: string;
    secure: string;
  }>,
) {
  const db = await getDb();

  const rows = Object.entries(values).map(([key, value]) => {
    const encrypted = encrypt(String(value));
    return {
      tenantId,
      provider: 'SMTP',
      key,
      encryptedValue: encrypted.encrypted,
      iv: encrypted.iv,
      authTag: encrypted.authTag,
    };
  });

  if (rows.length) {
    await db.insert(integrationCredentials).values(rows as any);
  }
}

async function seedDbSmtpConfigThatFailsDecrypt(tenantId: string) {
  const db = await getDb();
  await db.insert(integrationCredentials).values({
    tenantId,
    provider: 'SMTP',
    key: 'host',
    encryptedValue: 'deadbeef',
    iv: '00',
    authTag: '00',
  } as any);
}

beforeAll(async () => {
  mock.module('nodemailer', () => ({
    default: {
      createTransport: (cfg: Record<string, unknown>) => {
        transportConfigs.push(cfg);
        if (transporterDisabled) return null;

        return {
          sendMail: async (payload: Record<string, unknown>) => {
            sentMails.push(payload);
          },
        };
      },
    },
  }));

  emailModule = await import('../src/lib/email');
});

afterAll(() => {
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  restoreEnv();
  transportConfigs = [];
  sentMails = [];
  transporterDisabled = false;
});

afterEach(() => {
  restoreEnv();
});

describe('email lib', () => {
  test('returns false when neither DB nor env has SMTP config', async () => {
    clearSmtpEnv();

    const ok = await emailModule.sendTestEmail('user@fueld.test');
    expect(ok).toBe(false);
    expect(transportConfigs.length).toBe(0);
    expect(sentMails.length).toBe(0);
  });

  test('sends invite email using env SMTP config', async () => {
    clearSmtpEnv();
    setSmtpEnv({
      host: 'smtp.env.test',
      port: '2525',
      user: 'env-user',
      pass: 'env-pass',
      from: 'noreply@env.test',
      secure: 'false',
    });

    const ok = await emailModule.sendInviteEmail({
      to: 'invitee@fueld.test',
      invitedByName: 'Admin User',
      role: 'TRADER',
      inviteLink: 'https://app.fueld.test/invite/abc',
    });

    expect(ok).toBe(true);
    expect(transportConfigs.length).toBe(1);
    expect(transportConfigs[0]).toMatchObject({
      host: 'smtp.env.test',
      port: 2525,
      secure: false,
      auth: { user: 'env-user', pass: 'env-pass' },
    });

    expect(sentMails.length).toBe(1);
    expect(sentMails[0]).toMatchObject({
      from: 'noreply@env.test',
      to: 'invitee@fueld.test',
      subject: 'You have been invited to Fueld',
    });
    expect(String(sentMails[0]?.text)).toContain('Admin User invited you to Fueld as TRADER');
  });

  test('prefers DB SMTP config over env when DB config is complete', async () => {
    const seeded = await seedBasics();

    clearSmtpEnv();
    setSmtpEnv({
      host: 'smtp.env.test',
      port: '2525',
      user: 'env-user',
      pass: 'env-pass',
      from: 'noreply@env.test',
      secure: 'false',
    });

    await seedDbSmtpConfig(seeded.tenant.id, {
      host: 'smtp.db.test',
      port: '465',
      user: 'db-user',
      pass: 'db-pass',
      from: 'noreply@db.test',
      secure: 'true',
    });

    const ok = await emailModule.sendTestEmail('ops@fueld.test');
    expect(ok).toBe(true);

    expect(transportConfigs.length).toBe(1);
    expect(transportConfigs[0]).toMatchObject({
      host: 'smtp.db.test',
      port: 465,
      secure: true,
      auth: { user: 'db-user', pass: 'db-pass' },
    });

    expect(sentMails[0]).toMatchObject({
      from: 'noreply@db.test',
      to: 'ops@fueld.test',
      subject: 'Fueld SMTP test',
    });
  });

  test('falls back to env when DB config is incomplete or decrypt fails', async () => {
    const seeded = await seedBasics();

    clearSmtpEnv();
    setSmtpEnv({
      host: 'smtp.env2.test',
      port: '587',
      user: 'env2-user',
      pass: 'env2-pass',
      from: 'noreply@env2.test',
      secure: 'false',
    });

    // Incomplete DB config (only host)
    await seedDbSmtpConfig(seeded.tenant.id, {
      host: 'smtp.incomplete-db.test',
    });

    const okIncomplete = await emailModule.sendTestEmail('a@fueld.test');
    expect(okIncomplete).toBe(true);
    expect(transportConfigs[0]).toMatchObject({ host: 'smtp.env2.test' });

    transportConfigs = [];
    sentMails = [];
    await truncateAll();

    const reseeded = await seedBasics();

    // Decrypt failure inside DB config lookup
    await seedDbSmtpConfigThatFailsDecrypt(reseeded.tenant.id);

    const okError = await emailModule.sendTestEmail('b@fueld.test');
    expect(okError).toBe(true);
    expect(transportConfigs[0]).toMatchObject({ host: 'smtp.env2.test' });
  });

  test('returns false when transporter creation returns null', async () => {
    clearSmtpEnv();
    setSmtpEnv({
      host: 'smtp.env.test',
      port: '2525',
      user: 'env-user',
      pass: 'env-pass',
      from: 'noreply@env.test',
      secure: 'false',
    });

    transporterDisabled = true;
    const ok = await emailModule.sendTestEmail('nobody@fueld.test');
    expect(ok).toBe(false);
    expect(sentMails.length).toBe(0);
  });
});
