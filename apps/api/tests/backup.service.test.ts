import { beforeEach, describe, expect, test } from 'bun:test';
import type { BackupManifestDto } from '@fueld/types';
import { evaluateBackupCompatibility, parseEncryptedBackupHeader } from '../src/modules/admin/backup.service';

function makeManifest(overrides: Partial<BackupManifestDto> = {}): BackupManifestDto {
  return {
    backupFormatVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: '0.1.0',
    deployVersion: '0.1.0+deploy.1.sha.abc1234',
    gitSha: 'abc1234',
    gitBranch: 'main',
    schemaVersion: '0022_whatsapp_sessions',
    database: {
      engine: 'postgresql',
      dumpFile: 'db/dump.sql',
      migrationTags: ['0022_whatsapp_sessions'],
      latestMigrationTag: '0022_whatsapp_sessions',
    },
    contents: {
      uploadsIncluded: true,
      promptsIncluded: true,
      llmModelsIncluded: false,
      managedPaths: ['uploads/avatars', 'uploads/logos', 'uploads/attachments', 'prompts'],
      uploadFileCount: 3,
      uploadBytes: 1024,
      promptFileCount: 2,
      promptBytes: 256,
    },
    restorePolicy: {
      mode: 'replace-all',
      deleteTargetOnlyFiles: true,
      requiresConfirmationPhrase: true,
      confirmationPhrase: 'RESTORE ALL DATA',
    },
    crypto: {
      passwordRequired: true,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
    },
    ...overrides,
  };
}

describe('backup service helpers', () => {
  beforeEach(() => {
    process.env.CREDENTIALS_ENCRYPTION_KEY = 'unit-test-key';
  });

  test('parses encrypted backup header bytes', () => {
    const header = {
      version: 1,
      algorithm: 'aes-256-gcm',
      kdf: 'scrypt',
      saltHex: '00'.repeat(16),
      ivHex: '11'.repeat(12),
      authTagLength: 16,
    } as const;
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    const prefix = Buffer.from('FUELDBK1');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(headerBytes.length, 0);
    const payload = Buffer.concat([prefix, length, headerBytes, Buffer.from('deadbeef', 'hex')]);

    expect(parseEncryptedBackupHeader(payload)).toEqual(header);
  });

  test('marks matching manifest as compatible', () => {
    const manifest = makeManifest();

    const result = evaluateBackupCompatibility(manifest, {
      backupFormatVersion: 1,
      appVersion: '0.1.0',
      schemaVersion: '0022_whatsapp_sessions',
    });

    expect(result.compatible).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.warnings).toContain(
      'Ensure the target CREDENTIALS_ENCRYPTION_KEY matches the source instance before restore.',
    );
  });

  test('rejects schema mismatch', () => {
    const manifest = makeManifest({ schemaVersion: '0019_own_company_terms' });

    const result = evaluateBackupCompatibility(manifest, {
      backupFormatVersion: 1,
      appVersion: '0.1.0',
      schemaVersion: '0022_whatsapp_sessions',
    });

    expect(result.compatible).toBe(false);
    expect(result.issues[0]).toContain('Schema version mismatch');
  });
});