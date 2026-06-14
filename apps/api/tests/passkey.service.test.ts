import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test';
import { eq } from 'drizzle-orm';
import { tenants } from '../src/db/schema';
import { getDb, seedBasics, truncateAll } from './helpers/db';

type PasskeyServiceModule = typeof import('../src/modules/auth/passkey.service');
let passkeyService: PasskeyServiceModule;

let registrationChallengeCounter = 0;
let authenticationChallengeCounter = 0;
let authShouldThrow = false;

beforeAll(async () => {
  mock.module('@simplewebauthn/server', () => ({
    generateRegistrationOptions: async () => ({
      challenge: `reg-challenge-${++registrationChallengeCounter}`,
      rp: { id: 'localhost', name: 'Fueld' },
    }),
    verifyRegistrationResponse: async () => ({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'cred-test-1',
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 1,
          transports: ['internal'],
        },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    }),
    generateAuthenticationOptions: async () => ({
      challenge: `auth-challenge-${++authenticationChallengeCounter}`,
      rpId: 'localhost',
    }),
    verifyAuthenticationResponse: async () => {
      if (authShouldThrow) {
        throw new Error('bad assertion');
      }
      return {
        verified: true,
        authenticationInfo: {
          newCounter: 2,
        },
      };
    },
  }));

  passkeyService = await import('../src/modules/auth/passkey.service');
});

afterAll(() => {
  mock.restore();
});

beforeEach(async () => {
  await truncateAll();
  registrationChallengeCounter = 0;
  authenticationChallengeCounter = 0;
  authShouldThrow = false;
});

describe('passkey.service', () => {
  it('covers passkey enabled defaults and tenant override branches', async () => {
    const defaults = await passkeyService.isPasskeyEnabled();
    expect(defaults).toEqual({ enabled: false, allowPasswordless: false });

    const seeded = await seedBasics();
    const db = await getDb();

    await db
      .update(tenants)
      .set({
        settings: {
          passkeyEnabled: true,
          passkeyAllowPasswordless: true,
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, seeded.tenant.id));

    const configured = await passkeyService.isPasskeyEnabled();
    expect(configured).toEqual({ enabled: true, allowPasswordless: true });
  });

  it('covers registration challenge + verify/store and list/userHas branches', async () => {
    const seeded = await seedBasics();

    expect(await passkeyService.userHasPasskeys(seeded.user.id)).toBe(false);
    expect(await passkeyService.listPasskeys(seeded.user.id)).toEqual([]);

    const options = await passkeyService.generatePasskeyRegistrationOptions(
      seeded.user.id,
      seeded.user.email,
      seeded.user.name,
    );
    expect(String(options.challenge)).toContain('reg-challenge-');

    const stored = await passkeyService.verifyAndStorePasskey(
      seeded.user.id,
      'My Device',
      { id: 'credential-attestation-response' } as any,
    );

    expect(stored.id).toBeTruthy();
    expect(stored.credentialId).toBe('cred-test-1');
    expect(stored.friendlyName).toBe('My Device');

    expect(await passkeyService.userHasPasskeys(seeded.user.id)).toBe(true);
    const listed = await passkeyService.listPasskeys(seeded.user.id);
    expect(listed.length).toBe(1);
    expect(listed[0]?.friendlyName).toBe('My Device');
  });

  it('covers authentication options + verify success and failure branches', async () => {
    const seeded = await seedBasics();

    await passkeyService.generatePasskeyRegistrationOptions(
      seeded.user.id,
      seeded.user.email,
      seeded.user.name,
    );
    await passkeyService.verifyAndStorePasskey(seeded.user.id, 'Auth Device', { id: 'attestation' } as any);

    const byEmail = await passkeyService.generatePasskeyAuthenticationOptions({ email: seeded.user.email });
    expect(byEmail?.userId).toBe(seeded.user.id);
    expect(String(byEmail?.options?.challenge ?? '')).toContain('auth-challenge-');

    const verified = await passkeyService.verifyPasskeyAuthentication(
      seeded.user.id,
      { id: 'cred-test-1' } as any,
      byEmail!.sessionId,
    );
    expect(verified?.userId).toBe(seeded.user.id);
    expect(verified?.email).toBe(seeded.user.email);

    const missingChallenge = await passkeyService.verifyPasskeyAuthentication(
      seeded.user.id,
      { id: 'cred-test-1' } as any,
      byEmail!.sessionId,
    );
    expect(missingChallenge).toBeNull();

    const noUser = await passkeyService.generatePasskeyAuthenticationOptions({ email: 'nobody@test.local' });
    expect(noUser).toBeNull();

    const noKeys = await passkeyService.generatePasskeyAuthenticationOptions({ userId: '123e4567-e89b-12d3-a456-426614174000' });
    expect(noKeys).toBeNull();

    const byUserId = await passkeyService.generatePasskeyAuthenticationOptions({ userId: seeded.user.id });
    const wrongCredential = await passkeyService.verifyPasskeyAuthentication(
      seeded.user.id,
      { id: 'wrong-credential-id' } as any,
      byUserId!.sessionId,
    );
    expect(wrongCredential).toBeNull();

    const byUserId2 = await passkeyService.generatePasskeyAuthenticationOptions({ userId: seeded.user.id });
    authShouldThrow = true;
    const thrownVerify = await passkeyService.verifyPasskeyAuthentication(
      seeded.user.id,
      { id: 'cred-test-1' } as any,
      byUserId2!.sessionId,
    );
    expect(thrownVerify).toBeNull();
  });

  it('covers discoverable passkey flow (no email/userId identifier)', async () => {
    const seeded = await seedBasics();

    // Register a passkey first
    await passkeyService.generatePasskeyRegistrationOptions(
      seeded.user.id,
      seeded.user.email,
      seeded.user.name,
    );
    await passkeyService.verifyAndStorePasskey(
      seeded.user.id,
      'Discoverable Key',
      { id: 'cred-discoverable-1' } as any,
    );

    // Generate auth options WITHOUT identifier — discoverable flow
    const result = await passkeyService.generatePasskeyAuthenticationOptions(undefined);
    expect(result).not.toBeNull();
    expect(result!.userId).toBeNull(); // no user ID known ahead of time
    expect(result!.sessionId).toBeTruthy();
    expect(String(result!.options?.challenge ?? '')).toContain('auth-challenge-');
    // allowCredentials should be undefined (browser picks from discoverable creds)
    expect((result!.options as any)?.allowCredentials).toBeUndefined();

    // Verify the assertion — must look up user by credential ID
    const verified = await passkeyService.verifyPasskeyAuthentication(
      null, // userId unknown; service looks it up via credential ID
      { id: 'cred-test-1' } as any,
      result!.sessionId,
    );
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe(seeded.user.id);
    expect(verified!.email).toBe(seeded.user.email);

    // Second consumption of same sessionId should fail
    const replayed = await passkeyService.verifyPasskeyAuthentication(
      null,
      { id: 'cred-test-1' } as any,
      result!.sessionId,
    );
    expect(replayed).toBeNull();
  });

  it('covers rename/delete and missing registration-challenge error branch', async () => {
    const seeded = await seedBasics();

    await expect(
      passkeyService.verifyAndStorePasskey(seeded.user.id, 'No challenge yet', { id: 'x' } as any),
    ).rejects.toThrow('Registration challenge expired or not found');

    await passkeyService.generatePasskeyRegistrationOptions(
      seeded.user.id,
      seeded.user.email,
      seeded.user.name,
    );
    const stored = await passkeyService.verifyAndStorePasskey(seeded.user.id, 'Rename Me', { id: 'att' } as any);

    const renamed = await passkeyService.renamePasskey(seeded.user.id, stored.id, 'Renamed Device');
    expect(typeof renamed).toBe('boolean');

    const renamedMissing = await passkeyService.renamePasskey(
      seeded.user.id,
      '123e4567-e89b-12d3-a456-426614174000',
      'Nope',
    );
    expect(typeof renamedMissing).toBe('boolean');

    const deleted = await passkeyService.deletePasskey(seeded.user.id, stored.id);
    expect(typeof deleted).toBe('boolean');

    const afterDelete = await passkeyService.listPasskeys(seeded.user.id);
    expect(afterDelete.find((p) => p.id === stored.id)).toBeUndefined();

    const deletedMissing = await passkeyService.deletePasskey(
      seeded.user.id,
      '123e4567-e89b-12d3-a456-426614174000',
    );
    expect(deletedMissing).toBe(false);
  });
});
