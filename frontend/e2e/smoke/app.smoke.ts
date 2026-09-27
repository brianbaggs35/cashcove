import { expect, test } from '@playwright/test'

import { AppShell, TABS, type Tab } from '../support/pages/app-shell'
import { SignInPage } from '../support/pages/sign-in-page'
import { ADMIN, collectProblems, HOUSEHOLD, setting } from './admin'

const SETTINGS = [
  'general',
  'categories',
  'users',
  'alerts',
  'sync',
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

  await shell.signOut()
  await expect(signInPage.notice).toHaveText("You've signed out. See you soon.")
  expect(problems).toEqual([])
})
