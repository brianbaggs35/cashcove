import { dateOf, expect, setUpAi, signInFiles, TABS, test } from '../support'

interface Review {
  id: string
  status: string
}

test.describe('The AI tab', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('for a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('isn’t offered in the navigation', async ({ page, shell }) => {
      await page.goto('/accounts')
      await shell.showMenu()

      await expect(shell.sideMenu.getByRole('link', { name: TABS.ai, exact: true })).toHaveCount(0)
      // Every other tab is there.
      await expect(shell.sideMenu.getByRole('link', { name: TABS.automations })).toBeVisible()
      await expect(shell.sideMenu.getByRole('link', { name: TABS.settings })).toBeVisible()
    })

    test('can’t be opened from its address either', async ({ page }) => {
      for (const path of ['/ai', '/ai/recommendations', '/ai/usage']) {
        await page.goto(path)

        await expect(page).toHaveURL(/\/dashboard$/)
        await expect(page.getByRole('heading', { level: 1, name: TABS.dashboard })).toBeVisible()
      }
    })

    test('isn’t mentioned on the dashboard, which tells admins what is waiting there', async ({
      apiAs,
      browser,
      dashboardPage,
    }) => {
      const admin = await apiAs('admin')
      await setUpAi(admin)
      const review = await admin.post<Review>('/ai/reviews', {
        scope: 'recent',
        days: 30,
        limit: 50,
        today: dateOf({ days_ago: 0 }),
      })
      await expect
        .poll(async () => (await admin.get<Review>(`/ai/reviews/${review.id}`)).status)
        .toBe('done')

      await dashboardPage.goto()
      await expect(dashboardPage.page.getByTestId('attention-ai')).toHaveCount(0)

      const adminPage = await (
        await browser.newContext({ storageState: signInFiles.admin })
      ).newPage()
      await adminPage.goto('/dashboard')
      await expect(adminPage.getByTestId('attention-ai')).toBeVisible()
    })

    test('is refused by the server too', async ({ apiAs }) => {
      await setUpAi(await apiAs('admin'))
      const viewer = await apiAs('viewer')
      const today = dateOf({ days_ago: 0 })
      const someone = '2f6f1c1a-0000-4000-8000-000000000001'

      const refused = [
        () =>
          viewer.post('/ai/chat', {
            messages: [{ role: 'user', content: 'Where could I cut back?' }],
            today,
          }),
        () => viewer.get('/ai/usage'),
        () => viewer.get('/ai/reviews'),
        () => viewer.get(`/ai/reviews/${someone}`),
        () => viewer.get('/ai/recommendations'),
        () => viewer.post('/ai/reviews', { scope: 'recent', days: 30, limit: 50, today }),
        () => viewer.post('/ai/recommendations/apply', { ids: [someone] }),
        () => viewer.post('/ai/recommendations/dismiss', { ids: [someone] }),
        () => viewer.post('/ai/statements', { file_name: 'a.pdf', content: 'JVBERg==' }),
        () => viewer.post('/ai/automation-suggestions'),
      ]
      for (const attempt of refused) {
        await expect(attempt()).rejects.toThrow(/failed with 403/)
      }
    })
  })

  test.describe('for an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('is in the navigation, and opens', async ({ page, shell }) => {
      await page.goto('/accounts')

      await shell.open('ai')

      await expect(page.getByRole('heading', { level: 1, name: TABS.ai })).toBeVisible()
    })
  })
})
