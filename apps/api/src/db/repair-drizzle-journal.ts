import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import postgres from 'postgres';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface JournalFile {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

const DRIZZLE_DIR = resolve(process.cwd(), 'drizzle');
const JOURNAL_PATH = join(DRIZZLE_DIR, 'meta', '_journal.json');
const REQUIRED_TABLES = ['tenants', 'users', 'order_items'];

function parseArgs(argv: string[]): { urls: string[]; dryRun: boolean } {
  const urls: string[] = [];
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    urls.push(arg);
  }

  return { urls, dryRun };
}

function loadJournal(): JournalFile {
  if (!existsSync(JOURNAL_PATH)) {
    throw new Error(`Drizzle journal not found at ${JOURNAL_PATH}`);
  }

  return JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as JournalFile;
}

function migrationHash(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

async function ensureDatabaseLooksInitialized(sql: postgres.Sql): Promise<void> {
  const rows = await sql.unsafe(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name in (${REQUIRED_TABLES.map((name) => `'${name}'`).join(', ')})`,
  ) as Array<{ table_name: string }>;

  const present = new Set(rows.map((row) => row.table_name));
  const missing = REQUIRED_TABLES.filter((tableName) => !present.has(tableName));
  if (missing.length > 0) {
    throw new Error(`Database does not look like an initialized Fueld schema. Missing tables: ${missing.join(', ')}`);
  }
}

async function ensureMigrationTable(sql: postgres.Sql): Promise<void> {
  await sql.unsafe('create schema if not exists drizzle');
  await sql.unsafe(`
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    )
  `);
}

async function repairJournal(url: string, dryRun: boolean): Promise<void> {
  const journal = loadJournal();
  const sql = postgres(url, { max: 1 });

  try {
    await ensureDatabaseLooksInitialized(sql);
    await ensureMigrationTable(sql);

    const existingRows = await sql.unsafe('select hash from drizzle.__drizzle_migrations') as Array<{ hash: string }>;
    const existingHashes = new Set(existingRows.map((row) => row.hash));

    const missingEntries = journal.entries
      .map((entry) => ({
        entry,
        filePath: join(DRIZZLE_DIR, `${entry.tag}.sql`),
      }))
      .filter(({ filePath }) => existsSync(filePath))
      .map(({ entry, filePath }) => ({
        entry,
        filePath,
        hash: migrationHash(filePath),
      }))
      .filter(({ hash }) => !existingHashes.has(hash));

    if (missingEntries.length === 0) {
      console.log(`[repair-drizzle-journal] ${url} already matches the current migration inventory.`);
      return;
    }

    console.log(`[repair-drizzle-journal] ${url}`);
    console.log(`[repair-drizzle-journal] Missing ${missingEntries.length} journal row(s): ${missingEntries.map(({ entry }) => entry.tag).join(', ')}`);

    if (dryRun) {
      console.log('[repair-drizzle-journal] Dry run only. No rows inserted.');
      return;
    }

    for (const { entry, hash } of missingEntries) {
      await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${String(entry.when)})`;
    }

    console.log(`[repair-drizzle-journal] Inserted ${missingEntries.length} journal row(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const { urls, dryRun } = parseArgs(process.argv.slice(2));
const targetUrls = urls.length > 0 ? urls : [process.env['DATABASE_URL']].filter((value): value is string => Boolean(value));

if (targetUrls.length === 0) {
  throw new Error('Provide at least one database URL argument or set DATABASE_URL.');
}

for (const url of targetUrls) {
  await repairJournal(url, dryRun);
}