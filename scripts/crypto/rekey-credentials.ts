/**
 * Re-encrypt stored credentials under CREDENTIALS_ENCRYPTION_KEY.
 *
 * Why this exists
 * ---------------
 * `getKey()` used to fall back to a key derived from `DATABASE_URL` when
 * CREDENTIALS_ENCRYPTION_KEY was unset. Every deployed instance ran that way
 * (none of them set NODE_ENV, so the production guard never fired), and when
 * CREDENTIALS_ENCRYPTION_KEY was introduced the fallback was dropped. Any datum
 * written before the key was set is therefore sealed under
 * `sha256("fueld-creds:" + DATABASE_URL)` and can no longer be opened — AES-GCM
 * fails authentication with "Unsupported state or unable to authenticate data"
 * rather than a clear "wrong key" error.
 *
 * Riviera Marine hit exactly this: its Microsoft refresh tokens and Enable
 * Banking tokens were written on 2026-08-26 under the derived key, so every
 * document email fell back from GRAPH to SMTP. The data is NOT lost — the old
 * key is reproducible from the current DATABASE_URL — it just has to be
 * re-sealed under the configured key.
 *
 * Usage (on the host, with the environment loaded):
 *
 *   DATABASE_URL=... CREDENTIALS_ENCRYPTION_KEY=... \
 *     bun scripts/crypto/rekey-credentials.ts          # dry run
 *   ... bun scripts/crypto/rekey-credentials.ts --apply  # commit
 *
 * Safe to run repeatedly: values that already open under the configured key are
 * counted as `already_ok` and left alone. Values that open under neither key are
 * reported as unreadable and skipped — they cannot be recovered from here (the
 * user must re-link the integration), and no row is ever half-written: each
 * value is replaced together with its own IV and auth tag.
 *
 * Plaintext is never printed.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import postgres from 'postgres';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/** One encrypted value and the two columns that belong with it. */
type EncryptedColumns = { value: string; iv: string; authTag: string };

/** A table plus the encrypted values to walk on each of its rows. */
type Target = { table: string; idColumn: string; columns: EncryptedColumns[] };

/**
 * Every encrypted column in the schema. Kept as data rather than queries so a
 * new encrypted field is one line here, and the failure mode is "not covered
 * yet" instead of "silently missed".
 */
const TARGETS: Target[] = [
  {
    table: 'users',
    idColumn: 'id',
    columns: [
      {
        value: 'microsoft_refresh_token',
        iv: 'microsoft_refresh_token_iv',
        authTag: 'microsoft_refresh_token_auth_tag',
      },
    ],
  },
  {
    table: 'integration_credentials',
    idColumn: 'id',
    columns: [{ value: 'encrypted_value', iv: 'iv', authTag: 'auth_tag' }],
  },
  {
    table: 'enable_banking_user_credentials',
    idColumn: 'id',
    columns: [
      { value: 'private_key_encrypted', iv: 'private_key_iv', authTag: 'private_key_auth_tag' },
      { value: 'id_token_encrypted', iv: 'id_token_iv', authTag: 'id_token_auth_tag' },
      { value: 'refresh_token_encrypted', iv: 'refresh_token_iv', authTag: 'refresh_token_auth_tag' },
    ],
  },
];

function deriveKey(secret: string): Buffer {
  // Same derivation as src/lib/crypto.ts — sha256 guarantees 32 bytes.
  return createHash('sha256').update(secret).digest();
}

/**
 * One encrypted value as selected below — aliased to `v`/`iv`/`tag` so callers
 * stay independent of the underlying column names.
 */
type Selected = { v: string; iv: string; tag: string };

/** Throws when the value does not authenticate under `key`. */
function open(key: Buffer, selected: Selected): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(selected.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(selected.tag, 'hex'));
  return decipher.update(selected.v, 'hex', 'utf8') + decipher.final('utf8');
}

function seal(key: Buffer, plaintext: string): EncryptedColumns {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const value = cipher.update(plaintext, 'utf8', 'hex') + cipher.final('hex');
  return { value, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const databaseUrl = process.env['DATABASE_URL'];
  const configuredKey = process.env['CREDENTIALS_ENCRYPTION_KEY'];

  if (!databaseUrl) throw new Error('DATABASE_URL must be set');
  if (!configuredKey) {
    throw new Error(
      'CREDENTIALS_ENCRYPTION_KEY must be set — it is the key everything is being re-encrypted TO. '
      + 'Without it there is nothing to migrate towards.',
    );
  }

  const currentKey = deriveKey(configuredKey);
  const legacyKey = deriveKey(`fueld-creds:${databaseUrl}`);

  const sql = postgres(databaseUrl, { max: 1 });
  let rekeyed = 0;
  let alreadyOk = 0;
  let unreadable = 0;

  try {
    for (const target of TARGETS) {
      for (const columns of target.columns) {
        const rows: Record<string, unknown>[] = await sql.unsafe(
          `select ${target.idColumn} as id, ${columns.value} as v, ${columns.iv} as iv,
                  ${columns.authTag} as tag
             from ${target.table}
            where coalesce(${columns.value}, '') <> ''`,
        );

        for (const raw of rows) {
          const selected: Selected = {
            v: raw['v'] as string,
            iv: raw['iv'] as string,
            tag: raw['tag'] as string,
          };
          const label = `${target.table}.${columns.value} ${raw['id']}`;

          try {
            open(currentKey, selected);
            alreadyOk++;
            continue;
          } catch {
            // Expected for anything written under the legacy key.
          }

          let plaintext: string;
          try {
            plaintext = open(legacyKey, selected);
          } catch {
            unreadable++;
            console.log(`  UNREADABLE ${label} — opens with neither key; needs re-linking`);
            continue;
          }

          const resealed = seal(currentKey, plaintext);
          if (apply) {
            await sql.unsafe(
              `update ${target.table}
                  set ${columns.value} = $1, ${columns.iv} = $2, ${columns.authTag} = $3
                where ${target.idColumn} = $4`,
              [resealed.value, resealed.iv, resealed.authTag, raw['id']],
            );
          }
          rekeyed++;
          console.log(`  ${apply ? 'rekeyed' : 'would rekey'} ${label}`);
        }
      }
    }
  } finally {
    await sql.end();
  }

  const mode = apply ? 'APPLIED' : 'DRY RUN (pass --apply to commit)';
  console.log(`\n${mode}: rekeyed=${rekeyed} already_ok=${alreadyOk} unreadable=${unreadable}`);
  if (unreadable > 0) {
    console.log('Unreadable values cannot be recovered here — the user must re-link that integration.');
  }
}

await main();
