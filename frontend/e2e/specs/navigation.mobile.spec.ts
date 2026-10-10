import { expect, TABS, test, type Tab } from '../support'

test.describe('Mobile navigation and layout', () => {
  test.beforeEach(async ({ baseline, signInAs }) => {
    await baseline.reset()
    await signInAs('admin')
  })

  test('uses one left drawer that closes after navigation', async ({ page, shell }) => {
    await page.goto('/dashboard')

    const toggle = page.getByTestId('mobile-nav-toggle')
    const drawer = page.getByRole('navigation', { name: 'Main navigation' })
    await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toHaveCount(0)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await shell.showMenu()
    await expect(drawer).toBeVisible()
    expect((await drawer.boundingBox())?.x).toBe(0)
    await drawer.getByRole('link', { name: 'Accounts' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Accounts' })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  test('every tab fits the phone viewport without page-level horizontal scrolling', async ({
    page,
    shell,
  }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/settings')

    for (const [tab, title] of Object.entries(TABS) as [Tab, string][]) {
      await shell.open(tab)
      await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
      const { clientWidth, scrollWidth } = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      expect(scrollWidth, `${title} should not overflow the phone viewport`).toBeLessThanOrEqual(
        clientWidth,
      )
    }
  })
})
