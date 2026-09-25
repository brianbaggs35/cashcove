import { expect, test } from '../support'

interface Preferences {
  general: { household_name: string }
}

test.describe('The baseline', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a reset undoes whatever an earlier test changed', async ({ baseline, apiAs }) => {
    const admin = await apiAs('admin')
    const preferences = await admin.get<Preferences>('/settings')
    await admin.put('/settings', {
      ...preferences,
      general: { ...preferences.general, household_name: 'Somebody else' },
    })

    await baseline.reset()

    const viewer = await apiAs('viewer')
    const restored = await viewer.get<Preferences>('/settings')
    expect(restored.general.household_name).toBe(baseline.household_name)
  })

  test('the pending invitation opens from its link', async ({ page, baseline }) => {
    const invitation = baseline.invitations.pending

    await page.goto(invitation.link)

    await expect(page.getByTestId('invite-email')).toHaveText(invitation.email)
  })

  test('a fresh install opens the setup wizard, which creates the first admin', async ({
    page,
    baseline,
  }) => {
    const setupCode = await baseline.freshInstall()

    await page.goto('/')
    await expect(page).toHaveURL(/\/welcome$/)
    await page.getByTestId('welcome-start').click()
    await page.getByTestId('setup-code').locator('input').fill(setupCode)
    await page.getByTestId('setup-code-submit').click()
    await page.getByTestId('account-name').locator('input').fill('Morgan Lee')
    await page.getByTestId('account-email').locator('input').fill('morgan@example.com')
    await page.getByTestId('account-password').locator('input').fill('quiet-harbor-lantern-9')
    await page.getByTestId('account-submit').click()
    await page.getByTestId('secure-skip').click()
    await page.getByTestId('household-skip').click()
    await page.getByTestId('welcome-finish').click()

    await expect(page).toHaveURL(/\/accounts$/)
  })
})
