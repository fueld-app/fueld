import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['WEB_PORT'] ?? '4200');
// IMPORTANT: the app switches API base URL based on hostname.
// Use "localhost" so dev mode uses http://localhost:3000 (not "/api").
const baseURL = process.env['WEB_BASE_URL'] ?? `http://localhost:${PORT}`;
const testDbUrl =
  process.env['TEST_DATABASE_URL']
  ?? process.env['E2E_TEST_DATABASE_URL']
  ?? 'postgres://fueld:fueld@localhost:5432/fueld_test';

const reuseExistingServers = !process.env['CI'] && process.env['E2E_REUSE_EXISTING_SERVERS'] === '1';
const isCI = !!process.env['CI'];

const apiCommand = isCI ? 'bun run src/index.ts' : 'bun run dev';
const webCommand = isCI
  ? `bun run start -- --port ${PORT} --host localhost --watch=false`
  : `bun run start -- --port ${PORT} --host localhost`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.js',
  webServer: [
    {
      command: apiCommand,
      cwd: '../api',
      port: 3000,
      reuseExistingServer: reuseExistingServers,
      env: {
        ...process.env,
        TEST_DATABASE_URL: testDbUrl,
        PORT: '3000',
      },
    },
    {
      command: webCommand,
      cwd: '.',
      port: PORT,
      reuseExistingServer: reuseExistingServers,
    },
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
