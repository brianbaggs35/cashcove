import { defineConfig, devices } from '@playwright/test'

// End-to-end tests run against the e2e image: the production container plus a test harness
// that resets its database (`make e2e`, or `make e2e-up` to keep it running). See e2e/README.md.
const baseURL = process.env.CASHCOVE_E2E_URL ?? 'https://localhost:9443'
const ci = !!process.env.CI

export default defineConfig({
  testDir: './e2e/specs',
  outputDir: './e2e-results/artifacts',
  // Every test shares one database, and resetting it mid-test would pull the rug out from
  // under another, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: [
    [ci ? 'github' : 'list'],
    ['html', { outputFolder: './e2e-results/report', open: 'never' }],
  ],
  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',
  use: {
    baseURL,
    // The test server's certificate is self-signed.
    ignoreHTTPSErrors: true,
    // The web app marks what tests look for with data-test="…".
    testIdAttribute: 'data-test',
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    // Phones get the bottom navigation bar and full-screen dialogs.
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
})
