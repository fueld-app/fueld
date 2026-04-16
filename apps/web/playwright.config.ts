import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['WEB_PORT'] ?? '4200');
// IMPORTANT: the app switches API base URL based on hostname.
// Use "localhost" so dev mode uses http://localhost:3000 (not "/api").
const baseURL = process.env['WEB_BASE_URL'] ?? `http://localhost:${PORT}`;
const testDbUrl =
  process.env['TEST_DATABASE_URL']
  ?? process.env['E2E_TEST_DATABASE_URL']
  ?? 'postgres://fueld:fueld@localhost:5432/fueld_test';

const reuseExistingServers = !process.env['CI'] || process.env['E2E_REUSE_EXISTING_SERVERS'] === '1';
const isCI = !!process.env['CI'];
const pwaTestMatch = /pwa\/.*\.spec\.ts/;

const apiCommand = isCI ? 'bun run src/index.ts' : 'bun run dev';
const webCommand = isCI
  ? `bun run start -- --port ${PORT} --host localhost --watch=false`
  : `bun run start -- --port ${PORT} --host localhost`;

// PWA tests need production build with service worker
const PWA_PORT = Number(process.env['PWA_PORT'] ?? '4250');
const pwaBaseURL = `http://localhost:${PWA_PORT}`;
const pwaServeCommand = `bunx serve dist/web/browser/browser -l ${PWA_PORT} -s --no-clipboard`;

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
    {
      command: pwaServeCommand,
      cwd: '.',
      port: PWA_PORT,
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
    // ── Desktop browsers ──────────────────────────────────────
    {
      name: 'chromium',
      testIgnore: pwaTestMatch,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testIgnore: pwaTestMatch,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testIgnore: pwaTestMatch,
      use: { ...devices['Desktop Safari'] },
    },

    // ── Mobile viewports ──────────────────────────────────────
    {
      name: 'mobile-chrome',
      testIgnore: pwaTestMatch,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'mobile-safari',
      testIgnore: pwaTestMatch,
      use: { ...devices['iPhone 14'] },
    },
    {
      name: 'tablet',
      testIgnore: pwaTestMatch,
      use: { ...devices['iPad (gen 7)'] },
    },

    // ── PWA / Service-worker ──────────────────────────────────
    // Uses a production build so the service worker is registered.
    {
      name: 'pwa',
      testMatch: pwaTestMatch,
      use: {
        ...devices['Pixel 7'],
        baseURL: pwaBaseURL,
      },
    },
  ],
});
