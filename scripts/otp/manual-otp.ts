import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { createHmac } from 'node:crypto';

type OutputMode = 'plain' | 'json' | 'env';

interface ManualOtpOptions {
  code?: string;
  secret?: string;
  label: string;
  digits: number;
  period: number;
  timestampMs?: number;
  outputMode: OutputMode;
}

function printHelp(): void {
  console.log(`Manual OTP helper

Usage:
  bun run otp:manual --code 123456
  bun run otp:manual --secret JBSWY3DPEHPK3PXP
  bun run otp:manual --label "Acme Service"
  OTP_CODE=123456 bun run otp:manual --json
  OTP_SECRET=JBSWY3DPEHPK3PXP bun run otp:manual --json

Options:
  --code <value>     OTP code to use right now
  --secret <value>   Base32 TOTP seed from the setup screen
  --label <value>    Friendly label shown in prompts/output
  --digits <value>   OTP length, usually 6 or 8
  --period <value>   TOTP period in seconds, usually 30
  --at <value>       Unix timestamp in seconds for deterministic generation
  --json             Print JSON output
  --env              Print shell-friendly output: OTP_CODE=<code>
  --help             Show this message

Notes:
  Use --code for fully manual entry.
  Use --secret when you have the authenticator setup key and want a generated TOTP.
`);
}

function parseArgs(argv: string[]): ManualOtpOptions {
  const options: ManualOtpOptions = {
    code: Bun.env.OTP_CODE,
    secret: Bun.env.OTP_SECRET,
    label: 'OTP',
    digits: 6,
    period: 30,
    outputMode: 'plain',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg === '--json') {
      options.outputMode = 'json';
      continue;
    }

    if (arg === '--env') {
      options.outputMode = 'env';
      continue;
    }

    if (arg === '--code') {
      options.code = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--secret') {
      options.secret = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--label') {
      options.label = argv[index + 1] || options.label;
      index += 1;
      continue;
    }

    if (arg === '--digits') {
      options.digits = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--period') {
      options.period = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    if (arg === '--at') {
      options.timestampMs = Number(argv[index + 1]) * 1000;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.digits) || options.digits < 6 || options.digits > 8) {
    throw new Error('OTP digits must be an integer between 6 and 8.');
  }

  if (!Number.isInteger(options.period) || options.period <= 0) {
    throw new Error('OTP period must be a positive integer.');
  }

  if (options.timestampMs !== undefined && !Number.isFinite(options.timestampMs)) {
    throw new Error('Timestamp must be a valid Unix time in seconds.');
  }

  return options;
}

function normalizeOtpCode(value: string): string {
  return value.replace(/\s+/g, '').trim();
}

function assertValidOtpCode(value: string): string {
  const normalized = normalizeOtpCode(value);

  if (!/^\d{6,8}$/.test(normalized)) {
    throw new Error('OTP code must be 6 to 8 digits.');
  }

  return normalized;
}

function normalizeOtpSecret(value: string): string {
  return value
    .replace(/[\s-]+/g, '')
    .replace(/=+$/g, '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .trim();
}

function decodeBase32(secret: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = normalizeOtpSecret(secret);

  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    throw new Error('OTP secret must be a valid base32 string.');
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Uint8Array.from(bytes);
}

function generateTotpCode(secret: string, digits: number, period: number, timestampMs: number): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(timestampMs / 1000 / period);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', Buffer.from(key)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);

  return String(binary % (10 ** digits)).padStart(digits, '0');
}

async function promptForCode(label: string): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(`Paste ${label} code: `);
    return assertValidOtpCode(answer);
  } finally {
    rl.close();
  }
}

function renderOutput(code: string, label: string, outputMode: OutputMode, source: 'manual' | 'totp', expiresInSeconds?: number): void {
  if (outputMode === 'json') {
    console.log(JSON.stringify({ label, code, source, expiresInSeconds }, null, 2));
    return;
  }

  if (outputMode === 'env') {
    console.log(`OTP_CODE=${code}`);
    return;
  }

  const expirySuffix = typeof expiresInSeconds === 'number'
    ? ` (expires in ${expiresInSeconds}s)`
    : '';
  console.log(`${label} code: ${code}${expirySuffix}`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.code && options.secret) {
    throw new Error('Use either --code or --secret, not both.');
  }

  const now = options.timestampMs ?? Date.now();
  const code = options.code
    ? assertValidOtpCode(options.code)
    : options.secret
      ? generateTotpCode(options.secret, options.digits, options.period, now)
      : await promptForCode(options.label);
  const source = options.secret ? 'totp' : 'manual';
  const expiresInSeconds = options.secret
    ? options.period - Math.floor(now / 1000) % options.period
    : undefined;

  renderOutput(code, options.label, options.outputMode, source, expiresInSeconds);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});