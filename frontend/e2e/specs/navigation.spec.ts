import { expect, TABS, test, type Tab } from '../support'

test.describe('Navigation', () => {
  test.beforeEach(async ({ baseline, signInAs }) => {
    await baseline.reset()
    await signInAs('viewer')
  })

  for (const [tab, title] of Object.entries(TABS) as [Tab, string][]) {
    test(`${title} opens from the navigation`, async ({ page, shell }) => {
      // Start somewhere else, so every tab is reached by clicking.
      await page.goto(tab === 'settings' ? '/accounts' : '/settings')

      await shell.open(tab)

      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
    })
  }

  test('signed-out visitors are sent to sign in, then back where they were going', async ({
    page,
    context,
    baseline,
    signInPage,
  }) => {
    await context.clearCookies()
    await page.goto('/settings/alerts')

    await expect(page).toHaveURL(/\/sign-in\?redirect=/)
    await signInPage.signIn(baseline.users.viewer)
    await expect(page).toHaveURL(/\/settings\/alerts$/)
  })
})
