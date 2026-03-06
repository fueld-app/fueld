const { spawnSync } = require('node:child_process');
const path = require('node:path');

module.exports = async () => {
  // This file lives at apps/web/e2e/global-setup.js
  const repoRoot = path.resolve(__dirname, '../../..');

  const testDbUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.E2E_TEST_DATABASE_URL ||
    'postgres://fueld:fueld@localhost:5432/fueld_test';

  const seedScript = 'apps/api/tests/helpers/seed-playwright.ts';
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = spawnSync('bun', ['run', seedScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TEST_DATABASE_URL: testDbUrl,
      },
      stdio: 'inherit',
    });

    if (result.status === 0) {
      return;
    }

    if (attempt < maxAttempts) {
      console.warn(
        `Playwright globalSetup seed attempt ${attempt}/${maxAttempts} failed; retrying...`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }

    throw new Error(
      `Playwright globalSetup failed while seeding via ${seedScript} (exit ${result.status ?? 'unknown'})`,
    );
  }
};
