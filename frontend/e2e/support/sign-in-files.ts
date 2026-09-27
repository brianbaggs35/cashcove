import path from 'node:path'

import type { SavedSignIn } from './harness'

/**
 * The admin's and the viewer's sign-ins, for `test.use({ storageState: signInFiles.admin })`.
 * Global setup saves them before every run. Each holds the cookie of a sign-in that's part of
 * the baseline, so it keeps working after every reset.
 */
export const signInFiles: Record<SavedSignIn, string> = {
  admin: path.resolve(import.meta.dirname, '../.auth/admin.json'),
  viewer: path.resolve(import.meta.dirname, '../.auth/viewer.json'),
}
