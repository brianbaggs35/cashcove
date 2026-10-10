import { expect, test } from '../support'

test.describe('Desktop navigation', () => {
  test.beforeEach(async ({ baseline, signInAs }) => {
    await baseline.reset()
    await signInAs('admin')
  })

  test('can be collapsed and expanded beside the Cashcove brand', async ({ page, shell }) => {
    await page.goto('/dashboard')

    const brand = shell.sideMenu.getByRole('link', { name: 'Cashcove Personal finance' })
    const toggle = page.getByTestId('nav-collapse-toggle')
    await expect(brand).toBeVisible()
    await expect(toggle).toBeVisible()
    const brandX = await brand.evaluate((element) => element.getBoundingClientRect().x)
    const toggleX = await toggle.evaluate((element) => element.getBoundingClientRect().x)
    expect(toggleX).toBeGreaterThan(brandX)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Expand navigation')
    await expect(shell.sideMenu.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-label', 'Collapse navigation')
  })
})
