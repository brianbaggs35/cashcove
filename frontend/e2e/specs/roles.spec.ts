import { expect, test } from '../support'

interface Preferences {
  general: { household_name: string }
}

test.describe('Admins and viewers', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin renames the household', async ({ page, baseline, signInAs, apiAs }) => {
    await signInAs('admin')
    await page.goto('/settings/general')
    const name = page.getByTestId('household-name').locator('input')
    await expect(name).toHaveValue(baseline.household_name)

    await name.fill('The Rivera-Chen household')
    await page.getByTestId('save').click()

    await expect(page.getByTestId('save-bar')).toBeHidden()
    const api = await apiAs('viewer')
    const saved = await api.get<Preferences>('/settings')
    expect(saved.general.household_name).toBe('The Rivera-Chen household')
  })

  test('a viewer sees the settings but cannot change them', async ({
    page,
    baseline,
    signInAs,
  }) => {
    await signInAs('viewer')
    await page.goto('/settings/general')

    await expect(page.getByTestId('read-only-notice')).toBeVisible()
    const name = page.getByTestId('household-name').locator('input')
    await expect(name).toHaveValue(baseline.household_name)
    await expect(name).not.toBeEditable()
  })
})
