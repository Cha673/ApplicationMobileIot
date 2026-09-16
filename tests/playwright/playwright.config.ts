import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  projects: [
    {
      name: 'api',
      use: {
        baseURL: process.env['API_URL'] ?? 'http://localhost:3000',
        extraHTTPHeaders: { Accept: 'application/json' },
      },
      testMatch: 'api/**/*.spec.ts',
    },
  ],
});
