const { spawnSync } = require('node:child_process');
const path = require('node:path');

function resolveBunCommand() {
  const homeDir = process.env.HOME || '';
  const candidates = [
    process.env.BUN_BINARY,
    process.env.BUN_PATH,
    'bun',
    '/opt/homebrew/bin/bun',
    '/usr/local/bin/bun',
    path.join(homeDir, '.bun/bin/bun'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'pipe' });
    if (!probe.error && probe.status === 0) {
      return candidate;
    }
  }

  throw new Error('Unable to locate a working bun executable for Playwright global setup');
}

module.exports = async () => {
  // This file lives at apps/web/e2e/global-setup.js
  const repoRoot = path.resolve(__dirname, '../../..');
  const bunCommand = resolveBunCommand();

  const testDbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.E2E_TEST_DATABASE_URL ||
    'postgres://fueld:fueld@localhost:5432/fueld_test';

  const seedScript = 'apps/api/tests/helpers/seed-playwright.ts';
  const maxAttempts = 20;
  const seedEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    TEST_DATABASE_URL: testDbUrl,
    DATABASE_URL: testDbUrl,
    NODE_ENV: 'test',
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync(bunCommand, ['run', seedScript], {
      cwd: repoRoot,
      env: seedEnv,
      stdio: 'pipe',
      encoding: 'utf8',
    });

    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);

    if (result.status === 0) {
      return;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `Playwright globalSetup seed attempt ${attempt}/${maxAttempts} failed; retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }

    throw new Error(
      `Playwright globalSetup failed while seeding via ${seedScript} using ${bunCommand} (exit ${result.status ?? 'unknown'})`,
    );
  }
};
