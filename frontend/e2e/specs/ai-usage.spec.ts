import { dateOf, expect, setUpAi, signInFiles, test } from '../support'

interface Review {
  id: string
  status: string
}

test.describe('AI usage', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('counts what the AI was asked and what it cost, by model and by what it was for', async ({
      aiPage,
      apiAs,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await aiPage.goto('usage')
      // Nothing has been asked yet.
      await expect(aiPage.page.getByTestId('usage-no-models')).toBeVisible()
      await expect(aiPage.usageTile('month')).toContainText('$0.00')
      await expect(aiPage.usageTile('month')).toContainText('0 calls')

      await api.post('/ai/test', {
        provider: 'openai',
        base_url: null,
        api_key: null,
        model: 'gpt-6-luna',
      })
      await api.post('/ai/chat', {
        messages: [{ role: 'user', content: 'How am I doing against my budgets?' }],
        today: dateOf({ days_ago: 0 }),
      })
      await aiPage.goto('usage')

      await expect(aiPage.page.getByTestId('usage-no-models')).toHaveCount(0)
      await expect(aiPage.usageTile('month')).toContainText('2 calls')
      await expect(aiPage.usageTile('range')).toContainText('Last 30 days')
      await expect(aiPage.usageTile('range')).toContainText('2 calls')
      // At OpenAI's list price for the model, which is a fraction of a cent for two small calls.
      const row = aiPage.modelRow('GPT-6 Luna (OpenAI)')
      await expect(row).toBeVisible()
      await expect(row).toContainText(/\$0\.0|<\$0\.0001/)
      await expect(aiPage.usageTile('in')).not.toContainText(/^\s*0\s/)
      await expect(
        aiPage.page.getByTestId('usage-table').nth(1).getByTestId('usage-row'),
      ).toHaveText([/Questions in the AI tab/, /Connection tests/])
      await expect(aiPage.pricing).toContainText(
        'You’re using GPT-6 Luna, at $0.10 in · $0.50 out per million tokens',
      )
      await expect(aiPage.pricing.getByTestId('pricing-openai')).toHaveAttribute(
        'href',
        'https://developers.openai.com/api/docs/pricing',
      )

      // Another range, ending today.
      await aiPage.showRange('7 days')
      await expect(aiPage.usageTile('range')).toContainText('Last 7 days')
      await expect(aiPage.usageTile('range')).toContainText('2 calls')
    })

    test('second opinions are counted too, and Ollama on your computer costs nothing', async ({
      aiPage,
      apiAs,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api, 'ollama_local')
      const review = await api.post<Review>('/ai/reviews', {
        scope: 'recent',
        days: 30,
        limit: 50,
        today: dateOf({ days_ago: 0 }),
      })
      await expect
        .poll(async () => (await api.get<Review>(`/ai/reviews/${review.id}`)).status)
        .toBe('done')

      await aiPage.goto('usage')

      const row = aiPage.modelRow('llama3.2:3b (Ollama (on your computer))')
      await expect(row).toBeVisible()
      await expect(row).toContainText('$0.00')
      await expect(aiPage.page.getByTestId('usage-free-note')).toContainText('costs nothing')
      await expect(
        aiPage.page.getByTestId('usage-table').nth(1).getByTestId('usage-row'),
      ).toHaveText([/Second opinions on categories/])
    })
  })

  test.describe('as a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('can see what it cost', async ({ aiPage, apiAs }) => {
      const admin = await apiAs('admin')
      await setUpAi(admin, 'anthropic')
      await admin.post('/ai/chat', {
        messages: [{ role: 'user', content: 'Where could I cut back?' }],
        today: dateOf({ days_ago: 0 }),
      })

      await aiPage.goto('usage')

      await expect(aiPage.usageTile('month')).toContainText('1 calls')
      await expect(aiPage.modelRow('Claude Haiku 4.5 (Anthropic)')).toBeVisible()
    })
  })
})
