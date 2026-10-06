import { expect, test } from '@playwright/test'

import { AppShell, TABS, type Tab } from '../support/pages/app-shell'
import { SignInPage } from '../support/pages/sign-in-page'
import { LINK_SCRIPT } from '../support/plaid'
import { ADMIN, collectProblems, HOUSEHOLD, setting } from './admin'

const SETTINGS = [
  'general',
  'users',
  'alerts',
  'sync',
  'ai',
  'account',
  'security',
  'appearance',
  'system',
]

test('the admin signs in, and every tab and settings page opens', async ({ page }) => {
  const problems = collectProblems(page)
  const signInPage = new SignInPage(page)
  const shell = new AppShell(page)

  await signInPage.goto()
  await signInPage.signIn({ email: ADMIN.email, password: setting('CASHCOVE_SMOKE_PASSWORD') })
  await expect(shell.accountMenu).toHaveAccessibleName(`Account menu for ${ADMIN.name}`)

  for (const [tab, title] of Object.entries(TABS) as [Tab, string][]) {
    await test.step(title, async () => {
      await shell.open(tab)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    })
  }
  for (const section of SETTINGS) {
    await test.step(`Settings: ${section}`, async () => {
      await page.goto(`/settings/${section}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    })
  }
  await page.goto('/settings/general')
  await expect(page.getByTestId('household-name').locator('input')).toHaveValue(HOUSEHOLD)

  // CI has no Plaid keys, so nothing opens Link; load its script the way the Connect tab does,
  // to check the Content Security Policy lets it in.
  await test.step('Plaid Link loads', async () => {
    await page.goto('/connect')
    const loaded = await page.evaluate(async (src) => {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = src
        script.addEventListener('load', resolve)
        script.addEventListener('error', reject)
        document.head.append(script)
      })
      return typeof (window as { Plaid?: { create?: unknown } }).Plaid?.create
    }, LINK_SCRIPT)
    expect(loaded).toBe('function')
  })

  await shell.signOut()
  await expect(signInPage.notice).toHaveText("You've signed out. See you soon.")
  expect(problems).toEqual([])
})
