import type { FullConfig } from '@playwright/test'

import { clearCoverage, coverageEnabled } from './coverage'
import { Harness } from './harness'
import { signInFiles } from './sign-in-files'

/**
 * Checks the test server is up and is the e2e image, starts from the baseline, and saves the
 * admin's and the viewer's sign-ins for `test.use({ storageState: signInFiles.admin })`.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL
  if (!baseURL) throw new Error('playwright.config.ts needs a baseURL')
  const harness = await Harness.connect(baseURL)
  try {
    await harness.waitUntilReady()
    await harness.reset()
    await harness.saveSignIn('admin', signInFiles.admin)
    await harness.saveSignIn('viewer', signInFiles.viewer)
  } finally {
    await harness.dispose()
  }
  if (coverageEnabled()) await clearCoverage()
}
