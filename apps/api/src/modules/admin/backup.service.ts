import { appendFile, cp, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { sql } from 'drizzle-orm';
import type {
  BackupCapabilitiesDto,
  BackupManifestDto,
  BackupStatusDto,
  BackupValidationDto,
} from '@fueld/types';
import { db } from '../../db';
import { getBuildInfo } from '../../lib/build-info';
import { getPromptsDir } from '../../lib/prompt-loader';
import { assertCredentialsEncryptionConfig, isProductionRuntime } from '../../lib/crypto';
import { beginRestoreMode, endRestoreMode, getRestoreState } from './backup-state';

const BACKUP_MAGIC = Buffer.from('FUELDBK1');
const HEADER_LENGTH_BYTES = 4;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SCRYPT_KEY_LENGTH = 32;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const BACKUP_FILE_EXTENSION = '.fueldbak';
const RESTORE_CONFIRMATION = 'RESTORE ALL DATA';

interface EncryptionHeader {
  version: number;
  algorithm: 'aes-256-gcm';
  kdf: 'scrypt';
  saltHex: string;
  ivHex: string;
  authTagLength: number;
}

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface CompatibilityContext {
  backupFormatVersion: number;
  appVersion: string;
  schemaVersion: string;
}

export function getRestoreConfirmationPhrase(): string {
  return RESTORE_CONFIRMATION;
}

export function getBackupStatus(): BackupStatusDto {
  const state = getRestoreState();
  return {
    restoreInProgress: state.active,
    startedAt: state.startedAt,
    message: state.message,
    confirmationPhrase: RESTORE_CONFIRMATION,
  };
}

function resolveUploadsRoot(): string {
  const cwd = process.cwd();
  const candidates = [
    join(cwd, 'uploads'),
    join(cwd, 'apps', 'api', 'uploads'),
    join(import.meta.dir, '../../../uploads'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  return candidates[0]!;
}

function resolveArchiveBaseName(manifest: BackupManifestDto): string {
  const timestamp = manifest.createdAt.replace(/[:.]/g, '-');
  return `fueld-backup-${manifest.appVersion}-${timestamp}${BACKUP_FILE_EXTENSION}`;
}

function getManagedPaths() {
  const uploadsRoot = resolveUploadsRoot();
  const promptsDir = getPromptsDir();

  return {
    uploadsRoot,
    promptsDir,
    uploads: {
      avatars: join(uploadsRoot, 'avatars'),
      logos: join(uploadsRoot, 'logos'),
      attachments: join(uploadsRoot, 'attachments'),
    },
  };
}

function runCommand(command: string[], env?: Record<string, string>): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe',
      env: env ? { ...process.env, ...env } : process.env,
    });

    Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
      .then(([stdout, stderr, exitCode]) => resolve({ stdout, stderr, exitCode }))
      .catch(reject);
  });
}

function hasCommand(command: string): boolean {
  const result = Bun.spawnSync(['which', command], { stdout: 'pipe', stderr: 'pipe' });
  return result.exitCode === 0;
}

async function listAppliedMigrations(): Promise<string[]> {
  try {
    const rows = (await db.execute(sql`
      SELECT tag
      FROM _applied_migrations
      ORDER BY tag ASC
    `)) as Array<{ tag: string }>;

    return rows.map((row) => row.tag);
  } catch {
    return [];
  }
}

function parseMajor(version: string): number | null {
  const match = version.match(/^(\d+)\./);
  return match ? Number(match[1]) : null;
}

function currentManifestBase(migrationTags: string[]): BackupManifestDto {
  const buildInfo = getBuildInfo();
  const latestMigrationTag = migrationTags.at(-1) ?? null;

  return {
    backupFormatVersion: buildInfo.backupFormatVersion,
    createdAt: new Date().toISOString(),
    appVersion: buildInfo.appVersion,
    deployVersion: buildInfo.deployVersion,
    gitSha: buildInfo.gitSha,
    gitBranch: buildInfo.gitBranch,
    schemaVersion: latestMigrationTag ?? 'untracked',
    database: {
      engine: 'postgresql',
      dumpFile: 'db/dump.sql',
      migrationTags,
      latestMigrationTag,
    },
    contents: {
      uploadsIncluded: true,
      promptsIncluded: true,
      llmModelsIncluded: false,
      managedPaths: ['uploads/avatars', 'uploads/logos', 'uploads/attachments', 'prompts'],
    },
    restorePolicy: {
      mode: 'replace-all',
      deleteTargetOnlyFiles: true,
      requiresConfirmationPhrase: true,
      confirmationPhrase: RESTORE_CONFIRMATION,
    },
    crypto: {
      passwordRequired: true,
      algorithm: ENCRYPTION_ALGORITHM,
      kdf: 'scrypt',
    },
  };
}

async function collectDirectoryStats(root: string): Promise<{ fileCount: number; totalBytes: number }> {
  if (!existsSync(root)) {
    return { fileCount: 0, totalBytes: 0 };
  }

  const entries: string[] = [];
  for await (const relativePath of new Bun.Glob('**/*').scan({ cwd: root, onlyFiles: true })) {
    entries.push(relativePath);
  }
  let totalBytes = 0;

  for (const relativePath of entries) {
    const fileStat = await stat(join(root, relativePath));
    totalBytes += fileStat.size;
  }

  return {
    fileCount: entries.length,
    totalBytes,
  };
}

async function buildManifest(): Promise<BackupManifestDto> {
  const migrationTags = await listAppliedMigrations();
  const manifest = currentManifestBase(migrationTags);
  const paths = getManagedPaths();
  const [uploadsStats, promptsStats] = await Promise.all([
    collectDirectoryStats(paths.uploadsRoot),
    collectDirectoryStats(paths.promptsDir),
  ]);

  manifest.contents.uploadFileCount = uploadsStats.fileCount;
  manifest.contents.uploadBytes = uploadsStats.totalBytes;
  manifest.contents.promptFileCount = promptsStats.fileCount;
  manifest.contents.promptBytes = promptsStats.totalBytes;

  return manifest;
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function copyIfExists(source: string, target: string): Promise<void> {
  if (!existsSync(source)) return;
  await ensureDir(join(target, '..'));
  await cp(source, target, { recursive: true, force: true });
}

async function encryptFile(inputPath: string, outputPath: string, password: string): Promise<void> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const cipher = createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
  const header: EncryptionHeader = {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    saltHex: salt.toString('hex'),
    ivHex: iv.toString('hex'),
    authTagLength: AUTH_TAG_LENGTH,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
  const lengthBytes = Buffer.alloc(HEADER_LENGTH_BYTES);
  lengthBytes.writeUInt32BE(headerBytes.length, 0);

  await writeFile(outputPath, Buffer.concat([BACKUP_MAGIC, lengthBytes, headerBytes]));
  await pipeline(createReadStream(inputPath), cipher, createWriteStream(outputPath, { flags: 'a' }));
  await appendFile(outputPath, cipher.getAuthTag());
}

async function parseEncryptionHeader(filePath: string): Promise<{ header: EncryptionHeader; headerSize: number; fileSize: number }> {
  const file = Bun.file(filePath);
  const fileSize = file.size;
  const prefixSize = BACKUP_MAGIC.length + HEADER_LENGTH_BYTES;
  const prefix = Buffer.from(await file.slice(0, prefixSize).arrayBuffer());

  if (!prefix.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Invalid backup file header');
  }

  const headerLength = prefix.readUInt32BE(BACKUP_MAGIC.length);
  const headerStart = prefixSize;
  const headerEnd = headerStart + headerLength;
  const headerBytes = Buffer.from(await file.slice(headerStart, headerEnd).arrayBuffer());
  const header = JSON.parse(headerBytes.toString('utf8')) as EncryptionHeader;

  if (header.algorithm !== 'aes-256-gcm' || header.kdf !== 'scrypt') {
    throw new Error('Unsupported backup encryption header');
  }

  return {
    header,
    headerSize: prefixSize + headerLength,
    fileSize,
  };
}

async function decryptFile(inputPath: string, outputPath: string, password: string): Promise<void> {
  const { header, headerSize, fileSize } = await parseEncryptionHeader(inputPath);
  const authTagLength = header.authTagLength ?? AUTH_TAG_LENGTH;

  if (fileSize <= headerSize + authTagLength) {
    throw new Error('Backup archive is truncated');
  }

  const authTagStart = fileSize - authTagLength;
  const authTag = Buffer.from(await Bun.file(inputPath).slice(authTagStart, fileSize).arrayBuffer());
  const key = scryptSync(password, Buffer.from(header.saltHex, 'hex'), SCRYPT_KEY_LENGTH);
  const decipher = createDecipheriv(header.algorithm, key, Buffer.from(header.ivHex, 'hex'));
  decipher.setAuthTag(authTag);

  await pipeline(
    createReadStream(inputPath, { start: headerSize, end: authTagStart - 1 }),
    decipher,
    createWriteStream(outputPath),
  );
}

async function createTarArchive(sourceDir: string, outputPath: string): Promise<void> {
  const result = await runCommand(['tar', '-czf', outputPath, '-C', sourceDir, '.']);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to create backup archive');
  }
}

async function extractTarArchive(archivePath: string, targetDir: string): Promise<void> {
  await ensureDir(targetDir);
  const result = await runCommand(['tar', '-xzf', archivePath, '-C', targetDir]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'Failed to extract backup archive');
  }
}

async function createDatabaseDump(outputPath: string): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL environment variable is required');

  const result = await runCommand([
    'pg_dump',
    '--dbname',
    databaseUrl,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    '--file',
    outputPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'pg_dump failed');
  }
}

async function restoreDatabaseFromDump(dumpPath: string): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) throw new Error('DATABASE_URL environment variable is required');

  const result = await runCommand([
    'psql',
    '--dbname',
    databaseUrl,
    '--set',
    'ON_ERROR_STOP=1',
    '--file',
    dumpPath,
  ]);

  if (result.exitCode !== 0) {
    throw new Error(result.stderr || 'psql restore failed');
  }
}

async function getCompatibilityContext(): Promise<CompatibilityContext> {
  const migrationTags = await listAppliedMigrations();
  const buildInfo = getBuildInfo();

  return {
    backupFormatVersion: buildInfo.backupFormatVersion,
    appVersion: buildInfo.appVersion,
    schemaVersion: migrationTags.at(-1) ?? 'untracked',
  };
}

function buildCompatibilityResult(
  manifest: BackupManifestDto,
  current: CompatibilityContext,
): Pick<BackupValidationDto, 'compatible' | 'issues' | 'warnings'> {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (manifest.backupFormatVersion !== current.backupFormatVersion) {
    issues.push(
      `Unsupported backup format version ${manifest.backupFormatVersion}. Server expects ${current.backupFormatVersion}.`,
    );
  }

  if (manifest.schemaVersion !== current.schemaVersion) {
    issues.push(
      `Schema version mismatch. Backup=${manifest.schemaVersion}, server=${current.schemaVersion}.`,
    );
  }

  const backupMajor = parseMajor(manifest.appVersion);
  const currentMajor = parseMajor(current.appVersion);
  if (backupMajor !== null && currentMajor !== null && backupMajor !== currentMajor) {
    warnings.push(`App major version differs. Backup=${manifest.appVersion}, server=${current.appVersion}.`);
  }

  if (!process.env['CREDENTIALS_ENCRYPTION_KEY']) {
    issues.push('CREDENTIALS_ENCRYPTION_KEY must be configured before restore.');
  } else {
    warnings.push('Ensure the target CREDENTIALS_ENCRYPTION_KEY matches the source instance before restore.');
  }

  if (!manifest.contents.uploadsIncluded) {
    warnings.push('Backup does not include uploads.');
  }
  if (!manifest.contents.promptsIncluded) {
    warnings.push('Backup does not include prompt markdown files.');
  }

  return {
    compatible: issues.length === 0,
    issues,
    warnings,
  };
}

async function readManifestFromExtractedArchive(extractedDir: string): Promise<BackupManifestDto> {
  const manifestPath = join(extractedDir, 'manifest.json');
  const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as BackupManifestDto;
  return parsed;
}

export async function getBackupCapabilities(): Promise<BackupCapabilitiesDto> {
  const migrationTags = await listAppliedMigrations();
  const buildInfo = getBuildInfo();
  const paths = getManagedPaths();
  const databaseUrlConfigured = Boolean(process.env['DATABASE_URL']);
  const credentialsEncryptionKeyConfigured = Boolean(process.env['CREDENTIALS_ENCRYPTION_KEY']);
  const credentialsEncryptionKeyRequired = isProductionRuntime();

  const commands = {
    pgDump: hasCommand('pg_dump'),
    psql: hasCommand('psql'),
    tar: hasCommand('tar'),
  };

  return {
    ready: commands.pgDump && commands.psql && commands.tar,
    runtime: {
      mode: isProductionRuntime()
        ? 'production'
        : process.env['NODE_ENV'] === 'test'
          ? 'test'
          : process.env['NODE_ENV'] === 'development'
            ? 'development'
            : 'unknown',
    },
    commands,
    current: {
      appVersion: buildInfo.appVersion,
      deployVersion: buildInfo.deployVersion,
      backupFormatVersion: buildInfo.backupFormatVersion,
      schemaVersion: migrationTags.at(-1) ?? 'untracked',
      latestMigrationTag: migrationTags.at(-1) ?? null,
    },
    paths: {
      promptsDir: paths.promptsDir,
      uploadsRoot: paths.uploadsRoot,
    },
    prerequisites: {
      credentialsEncryptionKeyConfigured,
      credentialsEncryptionKeyRequired,
      credentialEncryptionAvailable: credentialsEncryptionKeyConfigured || databaseUrlConfigured,
      databaseUrlConfigured,
    },
  };
}

export async function createBackupArchive(password: string): Promise<{ filePath: string; fileName: string; manifest: BackupManifestDto }> {
  assertCredentialsEncryptionConfig();

  if (!password || password.length < 8) {
    throw new Error('Backup password must be at least 8 characters long');
  }

  const capabilities = await getBackupCapabilities();
  if (!capabilities.ready) {
    throw new Error('Backup prerequisites are not available on this server');
  }

  const tempRoot = await createTempDir('fueld-backup-');
  const workspaceDir = join(tempRoot, 'workspace');
  const archivePath = join(tempRoot, 'archive.tar.gz');
  const outputPath = join(tempRoot, 'backup.enc');

  try {
    const manifest = await buildManifest();
    const paths = getManagedPaths();
    await ensureDir(workspaceDir);
    await ensureDir(join(workspaceDir, 'db'));
    await createDatabaseDump(join(workspaceDir, 'db', 'dump.sql'));
    await copyIfExists(paths.uploads.avatars, join(workspaceDir, 'uploads', 'avatars'));
    await copyIfExists(paths.uploads.logos, join(workspaceDir, 'uploads', 'logos'));
    await copyIfExists(paths.uploads.attachments, join(workspaceDir, 'uploads', 'attachments'));
    await copyIfExists(paths.promptsDir, join(workspaceDir, 'prompts'));
    await writeFile(join(workspaceDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await createTarArchive(workspaceDir, archivePath);
    await encryptFile(archivePath, outputPath, password);

    const fileName = resolveArchiveBaseName(manifest);
    const renamedPath = join(tempRoot, fileName);
    await cp(outputPath, renamedPath, { force: true });

    return { filePath: renamedPath, fileName, manifest };
  } catch (error) {
    await rm(tempRoot, { recursive: true, force: true });
    throw error;
  }
}

export async function validateBackupUpload(filePath: string, password: string, originalName: string, fileSize: number): Promise<BackupValidationDto> {
  const tempRoot = await createTempDir('fueld-validate-');
  const tarPath = join(tempRoot, 'archive.tar.gz');
  const extractedDir = join(tempRoot, 'contents');

  try {
    await decryptFile(filePath, tarPath, password);
    await extractTarArchive(tarPath, extractedDir);
    const manifest = await readManifestFromExtractedArchive(extractedDir);
    const result = buildCompatibilityResult(manifest, await getCompatibilityContext());

    return {
      fileName: originalName,
      fileSize,
      manifest,
      ...result,
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function replaceManagedFiles(extractedDir: string): Promise<void> {
  const paths = getManagedPaths();
  const extractedUploads = join(extractedDir, 'uploads');
  const extractedPrompts = join(extractedDir, 'prompts');

  await rm(paths.uploadsRoot, { recursive: true, force: true });
  await rm(paths.promptsDir, { recursive: true, force: true });

  await ensureDir(paths.uploadsRoot);
  await ensureDir(paths.promptsDir);

  await copyIfExists(extractedUploads, paths.uploadsRoot);
  await copyIfExists(extractedPrompts, paths.promptsDir);
}

export async function restoreBackupUpload(filePath: string, password: string, confirmation: string): Promise<BackupValidationDto> {
  assertCredentialsEncryptionConfig();

  if (confirmation.trim() !== RESTORE_CONFIRMATION) {
    throw new Error(`Confirmation phrase must exactly match "${RESTORE_CONFIRMATION}"`);
  }

  const tempRoot = await createTempDir('fueld-restore-');
  const tarPath = join(tempRoot, 'archive.tar.gz');
  const extractedDir = join(tempRoot, 'contents');

  try {
    const fileStat = await stat(filePath);
    const validation = await validateBackupUpload(filePath, password, basename(filePath), fileStat.size);
    if (!validation.compatible || !validation.manifest) {
      throw new Error(validation.issues[0] ?? 'Backup archive is not compatible with this server');
    }

    await decryptFile(filePath, tarPath, password);
    await extractTarArchive(tarPath, extractedDir);

    const dumpPath = join(extractedDir, validation.manifest.database.dumpFile);
    if (!existsSync(dumpPath)) {
      throw new Error('Backup archive is missing the database dump');
    }

    const filesRoot = join(extractedDir, 'uploads');
    const promptsRoot = join(extractedDir, 'prompts');
    if (!existsSync(filesRoot)) {
      validation.warnings.push('Backup archive does not contain uploads. Existing uploads will be deleted.');
    }
    if (!existsSync(promptsRoot)) {
      validation.warnings.push('Backup archive does not contain prompts. Existing prompts will be deleted.');
    }

    const result = { ...validation, fileName: basename(filePath), fileSize: fileStat.size };

    beginRestoreMode('Backup restore in progress');
    try {
      await restoreDatabaseFromDump(dumpPath);
      await replaceManagedFiles(extractedDir);
      return result;
    } finally {
      endRestoreMode();
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

export function parseEncryptedBackupHeader(input: Buffer): EncryptionHeader {
  if (input.length < BACKUP_MAGIC.length + HEADER_LENGTH_BYTES) {
    throw new Error('Backup header is truncated');
  }

  if (!input.subarray(0, BACKUP_MAGIC.length).equals(BACKUP_MAGIC)) {
    throw new Error('Invalid backup file header');
  }

  const headerLength = input.readUInt32BE(BACKUP_MAGIC.length);
  const start = BACKUP_MAGIC.length + HEADER_LENGTH_BYTES;
  const end = start + headerLength;
  if (input.length < end) {
    throw new Error('Backup header is truncated');
  }

  return JSON.parse(input.subarray(start, end).toString('utf8')) as EncryptionHeader;
}

export function evaluateBackupCompatibility(
  manifest: BackupManifestDto,
  current: CompatibilityContext,
): Pick<BackupValidationDto, 'compatible' | 'issues' | 'warnings'> {
  return buildCompatibilityResult(manifest, current);
}