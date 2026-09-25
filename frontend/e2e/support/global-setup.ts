import type { FullConfig } from '@playwright/test'

import { clearCoverage, coverageEnabled } from './coverage'
import { Harness } from './harness'

/** Checks the test server is up and is the e2e image, then starts from the baseline. */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error('playwright.config.ts needs a baseURL')
  const harness = await Harness.connect(baseURL)
  try {
    await harness.waitUntilReady()
    await harness.reset()
  } finally {
    await harness.dispose()
  }
  if (coverageEnabled()) await clearCoverage()
}
