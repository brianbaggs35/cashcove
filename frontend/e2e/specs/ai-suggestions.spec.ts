import { addPayment, dateOf, expect, setUpAi, signInFiles, test, type ApiClient } from '../support'

interface Transaction {
  id: string
  category_id: string | null
}

interface Category {
  id: string
  name: string
}

interface Review {
  id: string
  status: 'pending' | 'running' | 'done' | 'failed'
}

interface SuggestionPage {
  items: { id: string }[]
}

async function categoryId(api: ApiClient, name: string): Promise<string> {
  const groups = await api.get<{ categories: Category[] }[]>('/categories')
  const found = groups
    .flatMap((group) => group.categories)
    .find((category) => category.name === name)
  if (!found) throw new Error(`The baseline is missing the ${name} category`)
  return found.id
}

async function categoryOf(api: ApiClient, id: string): Promise<string | null> {
  return (await api.get<Transaction>(`/transactions/${id}`)).category_id
}

test.describe('The AI’s second opinion', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('a review suggests a category for what was left alone, and applying it changes the transaction', async ({
      aiPage,
      apiAs,
      baseline,
    }) => {
      const api = await apiAs('admin')
      const { venmo } = baseline.transactions
      await setUpAi(api)
      await aiPage.goto('recommendations')
      await expect(aiPage.page.getByTestId('recommendations-empty')).toContainText(
        'No suggestions yet',
      )

      await aiPage.review()

      // The automations left Venmo alone, so the AI says what it would file it under.
      const suggestion = aiPage.suggestion('Venmo')
      await expect(suggestion).toContainText('Uncategorized')
      await expect(suggestion).toContainText('Gifts & donations')
      await expect(suggestion.getByTestId('reco-confidence')).toHaveText('High confidence')
      await expect(suggestion.getByTestId('reco-reason')).toHaveText('A payee like Venmo.')
      await expect(aiPage.tile('open')).toContainText('1')
      await expect(aiPage.waiting).toContainText('1')
      // It only suggests: the transaction is as it was.
      expect(await categoryOf(api, venmo.id)).toBeNull()

      await aiPage.apply('Venmo')

      await expect(aiPage.suggestions).toHaveCount(0)
      await expect(aiPage.tile('applied')).toContainText('1')
      expect(await categoryOf(api, venmo.id)).toBe(await categoryId(api, 'Gifts & donations'))
      await aiPage.show('Applied')
      await expect(aiPage.suggestion('Venmo').getByTestId('reco-status')).toHaveText('Applied')
    })

    test('a dismissed suggestion does not come back, and a category chosen by hand is never second-guessed', async ({
      aiPage,
      apiAs,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      // A coffee shop's payment that someone put in Restaurants themselves.
      await api.post('/transactions', {
        account_id: baseline.accounts.checking.id,
        date: dateOf({ days_ago: 0 }),
        amount: '-5.25',
        payee: 'Starbucks',
        category_id: await categoryId(api, 'Restaurants'),
        notes: null,
      })
      await aiPage.goto('recommendations')

      await aiPage.review()

      // Only Venmo, which nobody chose a category for.
      await expect(aiPage.suggestions).toHaveCount(1)
      await expect(aiPage.suggestion('Starbucks')).toHaveCount(0)
      await aiPage.dismiss('Venmo')
      await expect(aiPage.tile('dismissed')).toContainText('1')
      await expect(aiPage.waiting).toHaveCount(0)

      // Looking again finds nothing new to say about it.
      await aiPage.review()
      await expect(aiPage.history.first().getByTestId('review-summary')).toContainText(
        'Nothing to suggest',
      )
      await expect(aiPage.tile('open')).toContainText('0')
      await expect(aiPage.tile('dismissed')).toContainText('1')
      await aiPage.show('Dismissed')
      await expect(aiPage.suggestion('Venmo').getByTestId('reco-status')).toHaveText('Dismissed')
    })

    test('several suggestions can be decided together', async ({ aiPage, apiAs, baseline }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      const starbucks = await addPayment(api, baseline, 'Starbucks', { amount: '-5.25' })
      const uber = await addPayment(api, baseline, 'Uber', { amount: '-18.40', daysAgo: 1 })
      await aiPage.goto('recommendations')

      await aiPage.review({ scope: 'Only uncategorized' })

      await expect(aiPage.suggestions).toHaveCount(3)
      await expect(aiPage.suggestion('Starbucks')).toContainText('Coffee')
      await expect(aiPage.suggestion('Uber')).toContainText('Rideshare & taxis')
      await aiPage.tick(['Starbucks', 'Uber'])
      await expect(aiPage.applySelected).toHaveText('Apply 2')
      await aiPage.applySelected.click()

      await expect(aiPage.suggestions).toHaveCount(1)
      await expect(aiPage.tile('applied')).toContainText('2')
      expect(await categoryOf(api, starbucks.id)).toBe(await categoryId(api, 'Coffee'))
      expect(await categoryOf(api, uber.id)).toBe(await categoryId(api, 'Rideshare & taxis'))

      // What's left is Venmo, which can be turned down along with whatever else is confident.
      await aiPage.selectConfident.click()
      await expect(aiPage.dismissSelected).toHaveText('Dismiss 1')
      await aiPage.dismissSelected.click()
      await expect(aiPage.suggestions).toHaveCount(0)
      await expect(aiPage.tile('dismissed')).toContainText('1')
      await expect(aiPage.waiting).toHaveCount(0)
    })

    test('a transaction that changed since is left alone when its suggestion is applied', async ({
      aiPage,
      apiAs,
      baseline,
    }) => {
      const api = await apiAs('admin')
      const { venmo } = baseline.transactions
      await setUpAi(api)
      await aiPage.goto('recommendations')
      await aiPage.review()
      await expect(aiPage.suggestion('Venmo')).toBeVisible()

      // Someone chooses a category while the suggestion waits.
      const shopping = await categoryId(api, 'Shopping')
      await api.patch(`/transactions/${venmo.id}`, { category_id: shopping })
      await aiPage.apply('Venmo')

      await expect(aiPage.suggestions).toHaveCount(0)
      expect(await categoryOf(api, venmo.id)).toBe(shopping)
    })

    test('what is sent for a review has the payees and categories, and nothing that says which account', async ({
      aiPage,
      apiAs,
      baseline,
      harness,
    }) => {
      await setUpAi(await apiAs('admin'), 'anthropic')
      await aiPage.goto('recommendations')

      await aiPage.review()

      const requests = await harness.aiRequests()
      expect(requests.length).toBeGreaterThan(0)
      const sent = requests.map((request) => request.body).join('\n')
      expect(sent).toContain('Venmo')
      for (const account of Object.values(baseline.accounts)) {
        expect(sent, `${account.name} was sent`).not.toContain(account.name)
        expect(sent, `${account.institution} was sent`).not.toContain(account.institution)
        expect(sent, `${account.name}’s last digits were sent`).not.toMatch(
          new RegExp(`(?<!\\d)${account.mask}(?!\\d)`),
        )
      }
    })

    test('the dashboard says suggestions are waiting, and links to them until they are decided', async ({
      page,
      aiPage,
      apiAs,
    }) => {
      await setUpAi(await apiAs('admin'))
      await aiPage.goto('recommendations')
      await aiPage.review()

      await page.goto('/dashboard')
      const note = page.getByTestId('attention-ai')
      await expect(note).toContainText(
        'The AI has 1 suggestion for how your transactions are sorted.',
      )
      await page.getByTestId('attention-ai-review').click()
      await expect(page).toHaveURL(/\/ai\/recommendations$/)

      await aiPage.apply('Venmo')
      await expect(aiPage.suggestions).toHaveCount(0)
      await page.goto('/dashboard')
      await expect(page.getByTestId('month-summary')).toBeVisible()
      await expect(page.getByTestId('attention-ai')).toHaveCount(0)
    })

    test('a review can’t be started before AI is set up', async ({ aiPage, apiAs }) => {
      const api = await apiAs('admin')
      await expect(
        api.post('/ai/reviews', {
          scope: 'recent',
          days: 30,
          limit: 50,
          today: dateOf({ days_ago: 0 }),
        }),
      ).rejects.toThrow(/failed with 409/)

      await aiPage.goto('recommendations')
      await expect(aiPage.reviewButton).toHaveCount(0)
      await expect(aiPage.page.getByTestId('recommendations-setup')).toBeVisible()
    })
  })

  test.describe('as a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('sees what the AI suggested, and can neither decide nor ask for a review', async ({
      aiPage,
      apiAs,
    }) => {
      const admin = await apiAs('admin')
      await setUpAi(admin)
      const review = await admin.post<Review>('/ai/reviews', {
        scope: 'recent',
        days: 30,
        limit: 50,
        today: dateOf({ days_ago: 0 }),
      })
      // It carries on after it has started.
      await expect
        .poll(async () => (await admin.get<Review>(`/ai/reviews/${review.id}`)).status)
        .toBe('done')

      await aiPage.goto('recommendations')

      await expect(aiPage.page.getByTestId('read-only-notice')).toBeVisible()
      const suggestion = aiPage.suggestion('Venmo')
      await expect(suggestion).toBeVisible()
      await expect(suggestion.getByTestId('reco-apply')).toHaveCount(0)
      await expect(suggestion.getByTestId('reco-dismiss')).toHaveCount(0)
      await expect(suggestion.getByTestId('recommendation-select')).toHaveCount(0)
      await expect(aiPage.reviewButton).toHaveCount(0)

      // The server says no as well.
      const viewer = await apiAs('viewer')
      const { items } = await viewer.get<SuggestionPage>('/ai/recommendations?status=open')
      const ids = items.map((item) => item.id)
      await expect(viewer.post('/ai/recommendations/apply', { ids })).rejects.toThrow(
        /failed with 403/,
      )
      await expect(viewer.post('/ai/recommendations/dismiss', { ids })).rejects.toThrow(
        /failed with 403/,
      )
      await expect(
        viewer.post('/ai/reviews', {
          scope: 'recent',
          days: 30,
          limit: 50,
          today: dateOf({ days_ago: 0 }),
        }),
      ).rejects.toThrow(/failed with 403/)
    })
  })
})
