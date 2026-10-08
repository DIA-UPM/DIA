// Playwright configuration. `npm test` builds the site first, then runs:
//   - functional: navigation, pages, responsive, console/network errors, WordPress independence,
//                 JSON editing (restores the original file byte-for-byte, even on failure)
//   - visual:     pixel comparison against the live-site baseline in tests/reference/
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  reporter: [['list'], ['html', { outputFolder: 'reports/playwright', open: 'never' }], ['json', { outputFile: 'reports/playwright-results.json' }]],
  outputDir: 'reports/test-artifacts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node scripts/build/serve.mjs --port ${PORT}`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    { name: 'functional', testDir: 'tests/functional', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'visual', testDir: 'tests/visual', testMatch: /.*\.spec\.mjs/, use: { ...devices['Desktop Chrome'], trace: 'off' } },
  ],
});
