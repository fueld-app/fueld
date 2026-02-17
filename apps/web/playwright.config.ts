import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['WEB_PORT'] ?? '4200');
// IMPORTANT: the app switches API base URL based on hostname.
// Use "localhost" so dev mode uses http://localhost:3000 (not "/api").
const baseURL = process.env['WEB_BASE_URL'] ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : [['list']],
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
