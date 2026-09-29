import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests on a phone viewport. Needs a migrated, empty-ish database (E2E_DATABASE_URL).
 * Servers are started here unless already running (reuseExistingServer), so `npm run test:e2e` works
 * both locally and in CI once `npm run build` has been run for api and web.
 */
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? 'postgresql://dari:dari@localhost:5432/dari_e2e';
export const MAIL_DIR = process.env.E2E_MAIL_DIR ?? '/tmp/dari-e2e-mail';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } }],
  webServer: [
    {
      command: 'node ../api/dist/main.js',
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: true,
      env: {
        DATABASE_URL,
        JWT_ACCESS_SECRET: 'e2e-secret-e2e-secret-e2e-secret-0000',
        MAIL_DRIVER: 'file',
        MAIL_FILE_DIR: MAIL_DIR,
        // Calendar fixtures are served from 127.0.0.1 over http: test servers only (refused in production).
        ICAL_ALLOW_INSECURE: 'true',
        APP_URL: 'http://localhost:3000',
        PORT: '3001',
      },
    },
    {
      command: 'npx next start -p 3000',
      url: 'http://localhost:3000/login',
      reuseExistingServer: true,
      env: { API_URL: 'http://localhost:3001' },
    },
  ],
});
