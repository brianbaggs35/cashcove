import { expect, signInFiles, test } from '../support'

test.describe('Starting signed in as the admin', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('opens the app without the sign-in form', async ({ page, baseline, shell }) => {
    await page.goto('/accounts')

    await expect(shell.accountMenu).toHaveAccessibleName(
      `Account menu for ${baseline.users.admin.name}`,
    )
  })

  test('stays signed in after a reset', async ({ page, baseline, shell }) => {
    await page.goto('/accounts')
    await expect(shell.accountMenu).toBeVisible()

    await baseline.reset()
    await page.reload()

    await expect(shell.accountMenu).toHaveAccessibleName(
      `Account menu for ${baseline.users.admin.name}`,
    )
  })
})

test.describe('Starting signed in as the viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('opens the app read-only', async ({ page, baseline, shell }) => {
    await page.goto('/transactions')

    await expect(shell.accountMenu).toHaveAccessibleName(
      `Account menu for ${baseline.users.viewer.name}`,
    )
    await expect(page.getByTestId('read-only-notice')).toBeVisible()
  })
})
