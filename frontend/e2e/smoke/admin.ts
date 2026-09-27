import type { Page } from '@playwright/test'

/** Reads a value CI passes in, or explains where the smoke test runs. */
export function setting(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} isn't set. The smoke test runs in CI against a fresh install of the production ` +
        'image; see e2e/README.md.',
    )
  }
  return value
}

/**
 * The first admin, whom the setup wizard creates. .github/scripts/smoke-test.sh signs in as
 * them too, with the same CASHCOVE_SMOKE_PASSWORD.
 */
export const ADMIN = { name: 'Smoke Test', email: 'smoke-test@example.com' }

export const HOUSEHOLD = 'The Smoke Test household'

/**
 * Collects what went wrong in the page while a test runs: uncaught errors, errors in the
 * console (Content Security Policy violations included) and server errors.
 */
export function collectProblems(page: Page): string[] {
  const problems: string[] = []
  page.on('pageerror', (error) => problems.push(error.message))
  page.on('console', (message) => {
    // A failed request logs one of these too; the responses below say which were errors.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      problems.push(message.text())
    }
  })
  page.on('response', (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} from ${response.url()}`)
  })
  return problems
}
