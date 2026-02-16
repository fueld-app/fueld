import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { seedBasics, truncateAll } from './helpers/db';

async function loadIntegrationsService() {
  return import('../src/modules/admin/integrations.service');
}

const originalFetch = globalThis.fetch;
const ORIGINAL_ENV = {
  LLI_USERNAME: process.env.LLI_USERNAME,
  LLI_PASSWORD: process.env.LLI_PASSWORD,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_SECURE: process.env.SMTP_SECURE,
};

function restoreEnv() {
  for (const [k, v] of Object.entries(ORIGINAL_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function clearEnv() {
  delete process.env.LLI_USERNAME;
  delete process.env.LLI_PASSWORD;
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_PORT;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
  delete process.env.SMTP_FROM;
  delete process.env.SMTP_SECURE;
}

describe('admin integrations.service', () => {
  beforeEach(async () => {
    await truncateAll();
    restoreEnv();
    clearEnv();
    globalThis.fetch = originalFetch;
  });

  afterEach(() => {
    restoreEnv();
    globalThis.fetch = originalFetch;
  });

  it('uses env fallback for LLI/SMTP when DB credentials are absent', async () => {
    await seedBasics();
    const svc = await loadIntegrationsService();

    process.env.LLI_USERNAME = 'lli-env-user';
    process.env.LLI_PASSWORD = 'lli-env-pass';
    process.env.SMTP_HOST = 'smtp.env.test';
    process.env.SMTP_PORT = '2525';
    process.env.SMTP_USER = 'smtp-env-user';
    process.env.SMTP_PASS = 'smtp-env-pass';
    process.env.SMTP_FROM = 'noreply@env.test';
    process.env.SMTP_SECURE = 'true';

    const status = await svc.getIntegrationStatus();

    const lli = status.find((s) => s.provider === 'LLI');
    const smtp = status.find((s) => s.provider === 'SMTP');
    const push = status.find((s) => s.provider === 'PUSH');
    const qb = status.find((s) => s.provider === 'QUICKBOOKS');

    expect(lli?.configured).toBe(true);
    expect(lli?.username).toBe('lli-env-user');

    expect(smtp?.configured).toBe(true);
    expect((smtp as any)?.smtpHost).toBe('smtp.env.test');
    expect((smtp as any)?.smtpPort).toBe(2525);
    expect((smtp as any)?.smtpUser).toBe('smtp-env-user');
    expect((smtp as any)?.smtpFrom).toBe('noreply@env.test');
    expect((smtp as any)?.smtpSecure).toBe(true);

    expect(push?.configured).toBe(false);
    expect(qb).toBeTruthy();
  });

  it('stores SMTP/PUSH credentials and reports DB-backed status with updater metadata', async () => {
    const { user } = await seedBasics();
    const svc = await loadIntegrationsService();

    await svc.setSmtpCredentials(
      'smtp.db.test',
      587,
      'db-smtp-user',
      'db-smtp-pass',
      'noreply@db.test',
      false,
      user.id,
    );

    await svc.setPushCredentials(
      'public-key-db',
      'private-key-db',
      'mailto:test@example.com',
      user.id,
    );

    const status = await svc.getIntegrationStatus();
    const smtp = status.find((s) => s.provider === 'SMTP');
    const push = status.find((s) => s.provider === 'PUSH');

    expect(smtp?.configured).toBe(true);
    expect((smtp as any)?.smtpHost).toBe('smtp.db.test');
    expect((smtp as any)?.smtpPort).toBe(587);
    expect((smtp as any)?.smtpUser).toBe('db-smtp-user');
    expect((smtp as any)?.smtpFrom).toBe('noreply@db.test');
    expect((smtp as any)?.smtpSecure).toBe(false);
    expect(smtp?.updatedBy).toBe(user.email);

    expect(push?.configured).toBe(true);
    expect((push as any)?.pushPublicKey).toBe('public-key-db');
    expect((push as any)?.pushSubject).toBe('mailto:test@example.com');
    expect(push?.updatedBy).toBe(user.email);
  });

  it('covers LLI verification HTTP and payload failure branches', async () => {
    await seedBasics();
    const svc = await loadIntegrationsService();

    globalThis.fetch = (async () => {
      return new Response('unauthorized', { status: 401, statusText: 'Unauthorized' });
    }) as unknown as typeof globalThis.fetch;

    await expect(svc.verifyLLICredentials('u', 'p')).rejects.toThrow('Verification failed: 401 Unauthorized');

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ Message: 'Denied', Payload: '' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    await expect(svc.verifyLLICredentials('u', 'p')).rejects.toThrow('Invalid credentials — LLI returned: Denied');
  });

  it('stores and reads LLI credentials and triggers token-cache clear callback', async () => {
    const { user } = await seedBasics();
    const svc = await loadIntegrationsService();

    let clearCount = 0;
    svc.registerTokenCacheClear(() => {
      clearCount += 1;
    });

    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ Message: 'Success', Payload: 'token-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof globalThis.fetch;

    await svc.setLLICredentials('lli-user', 'lli-pass', user.id);
    const creds = await svc.getLLICredentialsFromDB();

    expect(creds).toEqual({ username: 'lli-user', password: 'lli-pass' });
    expect(clearCount).toBe(1);
  });

  it('throws no-tenant errors for tenant-scoped writers', async () => {
    const svc = await loadIntegrationsService();

    await expect(svc.getIntegrationStatus()).rejects.toThrow('No tenant found');
    await expect(
      svc.setSmtpCredentials('h', 587, 'u', 'p', 'from@test', false, 'user-id'),
    ).rejects.toThrow('No tenant found');
    await expect(
      svc.setPushCredentials('pub', 'priv', 'mailto:test@example.com', 'user-id'),
    ).rejects.toThrow('No tenant found');
    await expect(svc.getLLICredentialsFromDB()).rejects.toThrow('No tenant found');
  });
});
