import { expect, setUpAi, signInFiles, test } from '../support'

test.describe('Mobile AI chat', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('answers questions and keeps the composer reachable', async ({ page, aiPage, apiAs }) => {
      await setUpAi(await apiAs('admin'))
      await aiPage.goto()

      await expect(page.getByTestId('mobile-nav-toggle')).toBeVisible()
      await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toHaveCount(0)

      await aiPage.ask('How much did I spend on coffee?')
      await expect(aiPage.messages.last()).toContainText(
        /I can see [1-9]\d* recent transactions\. You asked: How much did I spend on coffee\?/,
      )
      await expect(aiPage.input).toBeInViewport()
      await expect(aiPage.input).toBeEnabled()

      await aiPage.ask('What were my biggest expenses this month?')
      await expect(aiPage.messages.last()).toContainText(
        /You asked: What were my biggest expenses this month\?/,
      )
    })
  })
})
