import { defineConfig, devices } from '@playwright/test'

// CI's smoke test of the production image, in a browser: on a fresh install, the setup wizard
// creates the first admin, who then signs in and opens every tab. There's no test harness in
// this image, so nothing is reset; see e2e/README.md.
const ci = !!process.env.CI

export default defineConfig({
  testDir: './e2e/smoke',
  testMatch: '*.smoke.ts',
  outputDir: './e2e-results/smoke-artifacts',
  workers: 1,
  forbidOnly: ci,
  // The setup code works once, so a failed run can't be tried again on the same install.
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    [ci ? 'github' : 'list'],
    ['html', { outputFolder: './e2e-results/smoke-report', open: 'never' }],
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.CASHCOVE_SMOKE_URL ?? 'https://localhost:8443',
    // CI's certificate is self-signed.
    ignoreHTTPSErrors: true,
    testIdAttribute: 'data-test',
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: 'setup.smoke.ts' },
    // After a restart, CI runs this one alone: `npm run smoke -- --project=app --no-deps`.
    { name: 'app', testMatch: 'app.smoke.ts', dependencies: ['setup'] },
  ],
})
