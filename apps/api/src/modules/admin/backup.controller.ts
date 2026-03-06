import { Elysia, t } from 'elysia';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ApiResponse } from '@fueld/types';
import { authGuard } from '../auth/auth.guard';
import {
  createBackupArchive,
  getBackupCapabilities,
  getBackupStatus,
  restoreBackupUpload,
  validateBackupUpload,
} from './backup.service';

function requireAdmin(auth: { role: string } | undefined) {
  if (!auth || auth.role !== 'ADMIN') {
    throw new Error('Admin access required');
  }
}

async function writeUploadedFile(file: File, prefix: string): Promise<{ dir: string; filePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  const filePath = join(dir, file.name || 'backup.fueldbak');
  await Bun.write(filePath, file);
  return { dir, filePath };
}

export const backupController = new Elysia({ prefix: '/admin/backup' })
  .use(authGuard)
  .get('/status', async ({ auth }) => {
    try {
      requireAdmin(auth);
      return { success: true, data: getBackupStatus() } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load backup status';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin'], summary: 'Get backup/restore runtime status', security: [{ bearerAuth: [] }] },
  })
  .get('/capabilities', async ({ auth }) => {
    try {
      requireAdmin(auth);
      return { success: true, data: await getBackupCapabilities() } satisfies ApiResponse<unknown>;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load backup capabilities';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    detail: { tags: ['Admin'], summary: 'Get backup/export prerequisites and current versions', security: [{ bearerAuth: [] }] },
  })
  .post('/export', async ({ auth, body, set }) => {
    try {
      requireAdmin(auth);
      const archive = await createBackupArchive(body.password);
      set.headers['content-type'] = 'application/octet-stream';
      set.headers['content-disposition'] = `attachment; filename="${archive.fileName}"`;
      set.headers['x-backup-app-version'] = archive.manifest.appVersion;
      set.headers['x-backup-schema-version'] = archive.manifest.schemaVersion;
      setTimeout(() => {
        void rm(dirname(archive.filePath), { recursive: true, force: true });
      }, 5 * 60_000);
      return Bun.file(archive.filePath);
    } catch (err) {
      set.status = 400;
      const message = err instanceof Error ? err.message : 'Failed to export backup';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ password: t.String({ minLength: 8 }) }),
    detail: { tags: ['Admin'], summary: 'Export a password-protected full-instance backup', security: [{ bearerAuth: [] }] },
  })
  .post('/validate', async ({ auth, body, set }) => {
    try {
      requireAdmin(auth);
      const upload = await writeUploadedFile(body.file, 'fueld-upload-');

      try {
        const result = await validateBackupUpload(upload.filePath, body.password, body.file.name, body.file.size);
        return { success: true, data: result } satisfies ApiResponse<unknown>;
      } finally {
        await rm(upload.dir, { recursive: true, force: true });
      }
    } catch (err) {
      set.status = 400;
      const message = err instanceof Error ? err.message : 'Failed to validate backup';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({ file: t.File(), password: t.String({ minLength: 8 }) }),
    detail: { tags: ['Admin'], summary: 'Validate a password-protected backup archive before restore', security: [{ bearerAuth: [] }] },
  })
  .post('/restore', async ({ auth, body, set }) => {
    try {
      requireAdmin(auth);
      const upload = await writeUploadedFile(body.file, 'fueld-restore-upload-');

      try {
        const result = await restoreBackupUpload(upload.filePath, body.password, body.confirmation);
        return { success: true, data: result } satisfies ApiResponse<unknown>;
      } finally {
        await rm(upload.dir, { recursive: true, force: true });
      }
    } catch (err) {
      set.status = 400;
      const message = err instanceof Error ? err.message : 'Failed to restore backup';
      return { success: false, data: null, message } satisfies ApiResponse<null>;
    }
  }, {
    body: t.Object({
      file: t.File(),
      password: t.String({ minLength: 8 }),
      confirmation: t.String({ minLength: 1 }),
    }),
    detail: { tags: ['Admin'], summary: 'Restore a full-instance backup (destructive)', security: [{ bearerAuth: [] }] },
  });