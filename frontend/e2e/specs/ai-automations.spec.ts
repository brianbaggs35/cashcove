import {
  AI_KEYS,
  addChosen,
  addPayment,
  expect,
  holdAi,
  setUpAi,
  signInFiles,
  test,
  type ApiClient,
  type BaselineData,
} from '../support'

/**
 * A payee that people have put in the same category by hand, again and again, and that the
 * automations the household has don't sort: four payments to a pet supply store, each from a
 * different store number, chosen as Home goods, and two more with no category yet.
 */
async function petSupplies(api: ApiClient, baseline: BaselineData): Promise<void> {
  for (const number of [1, 2, 3, 4]) {
    await addChosen(api, baseline, `ZEPHYR PET SUPPLY #330${number}`, 'Home goods', {
      amount: '-23.50',
      daysAgo: number,
    })
  }
  await addPayment(api, baseline, 'ZEPHYR PET SUPPLY #3399', { amount: '-9.00', daysAgo: 6 })
  await addPayment(api, baseline, 'ZEPHYR PET SUPPLY #3398', { amount: '-14.00', daysAgo: 7 })
}

/** A bakery that was put in Coffee three times, to have a second suggestion. */
async function bakery(api: ApiClient, baseline: BaselineData): Promise<void> {
  for (const number of [1, 2, 3]) {
    await addChosen(api, baseline, `HEARTH BAKERY #77${number}`, 'Coffee', {
      amount: '-6.25',
      daysAgo: 10 + number,
    })
  }
}

test.describe('Suggesting automations with AI', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('is not there, and the tab is as it was, until AI is set up', async ({
      automationsPage,
    }) => {
      await automationsPage.goto()

      await expect(automationsPage.suggestButton).toHaveCount(0)
      await expect(automationsPage.addButton).toBeVisible()
    })

    test('suggests an automation for what was chosen by hand again and again, and makes it once checked', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await automationsPage.goto()

      await automationsPage.suggest()

      // What it would look for and give, what it comes from, and what it would do now.
      const card = automationsPage.suggestion('Zephyr Pet Supply')
      await expect(automationsPage.suggestions.getByTestId('suggestions-summary')).toHaveText(
        '1 suggestion from 1 payee you sorted by hand.',
      )
      await expect(card.getByTestId('suggestion-rule')).toContainText(
        'Payee starts with “ZEPHYR PET SUPPLY”, money out',
      )
      await expect(card.getByTestId('suggestion-rule')).toContainText('Home goods')
      await expect(card.getByTestId('suggestion-evidence')).toContainText('Chosen 4 times')
      await expect(card.getByTestId('suggestion-evidence')).toContainText(
        'Would sort 2 transactions with no category now',
      )
      await expect(card.getByTestId('suggestion-reason')).toHaveText(
        'Every one begins with ZEPHYR PET SUPPLY.',
      )

      // Making it opens the form for a new automation with all of that in it, which isn't made yet.
      await automationsPage.makeFromSuggestion('Zephyr Pet Supply')
      const form = automationsPage.dialog
      await expect(form.getByTestId('automation-chosen-payee')).toHaveText('ZEPHYR PET SUPPLY')
      await expect(form.getByTestId('automation-preview')).toContainText(
        'Matches 6 transactions you have now.',
      )
      expect(await api.get<unknown[]>('/automations')).toEqual([])
      await automationsPage.next()
      await expect(form.getByTestId('automation-name').getByRole('textbox')).toHaveValue(
        'Zephyr Pet Supply',
      )
      await expect(form.getByTestId('automation-category')).toContainText('Home goods')

      await automationsPage.save()

      // The suggestion says it was made, the automation is there, and what had no category has one.
      await expect(card.getByTestId('suggestion-created')).toBeVisible()
      await expect(card.getByTestId('suggestion-create')).toHaveCount(0)
      await automationsPage.suggestions.getByTestId('suggestions-close').click()
      await expect(automationsPage.card('Zephyr Pet Supply')).toBeVisible()
      const sorted = await api.get<{ total: number }>(
        `/transactions?q=ZEPHYR&category_id=${baseline.categories['Home goods'].id}`,
      )
      expect(sorted.total).toBe(6)
    })

    test('a suggestion can be put aside, and when all are, it says so', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await bakery(api, baseline)
      await automationsPage.goto()

      await automationsPage.suggest()
      // The most chosen first.
      await expect(automationsPage.suggestionCards.getByTestId('suggestion-name')).toHaveText([
        'Zephyr Pet Supply',
        'Hearth Bakery',
      ])

      await automationsPage.suggestion('Zephyr Pet Supply').getByTestId('suggestion-skip').click()
      await expect(automationsPage.suggestionCards).toHaveCount(1)
      await automationsPage.suggestion('Hearth Bakery').getByTestId('suggestion-skip').click()

      await expect(automationsPage.suggestionCards).toHaveCount(0)
      await expect(automationsPage.suggestions.getByTestId('suggestions-done')).toHaveText(
        'That’s all of them.',
      )
      // Looking again brings them back, since nothing was made.
      await automationsPage.suggestions.getByTestId('suggestions-again').click()
      await expect(automationsPage.suggestionCards).toHaveCount(2)
    })

    test('says there is nothing to suggest when no payee has had a category chosen enough', async ({
      apiAs,
      automationsPage,
      baseline,
      harness,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      // Twice is not often enough.
      for (const number of [1, 2]) {
        await addChosen(api, baseline, `ZEPHYR PET SUPPLY #330${number}`, 'Home goods')
      }
      await automationsPage.goto()

      await automationsPage.suggest()

      await expect(automationsPage.suggestions.getByTestId('suggestions-none')).toContainText(
        'Nothing to suggest yet',
      )
      // With nothing to look at, nothing was asked of the AI.
      expect(await harness.aiRequests()).toEqual([])
    })

    test('doesn’t suggest what an automation already sorts', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await api.post('/automations', {
        name: 'Pets',
        payees: ['zephyr pet'],
        match: 'contains',
        category_id: baseline.categories['Home goods'].id,
        apply_to: 'future',
      })
      await automationsPage.goto()

      await automationsPage.suggest()

      await expect(automationsPage.suggestions.getByTestId('suggestions-none')).toBeVisible()
    })

    test('warns when an older automation already gives some of it another category', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await api.post('/automations', {
        name: 'Everything is coffee',
        payees: ['zephyr'],
        match: 'contains',
        category_id: baseline.categories.Coffee.id,
        apply_to: 'future',
      })
      await automationsPage.goto()

      await automationsPage.suggest()

      await expect(
        automationsPage.suggestion('Zephyr Pet Supply').getByTestId('suggestion-overlap'),
      ).toHaveText('Everything is coffee already sorts some of these, and goes first.')
    })

    test('says it is looking while the AI works, and can be cancelled', async ({
      apiAs,
      automationsPage,
      baseline,
      page,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await automationsPage.goto()
      const holding = await holdAi(page, 'automation-suggestions')

      await automationsPage.suggestButton.click()

      const working = automationsPage.suggestions.getByTestId('suggestions-working')
      await expect(working.getByTestId('ai-progress-stage')).toHaveText(
        'Looking at the categories you chose by hand…',
      )
      await expect(working.getByTestId('ai-progress-privacy')).toContainText('go to GPT-6 Luna.')
      await automationsPage.suggestions.getByTestId('suggestions-close').click()
      await expect(automationsPage.suggestions).toBeHidden()

      const answered = page.waitForResponse('**/api/ai/automation-suggestions')
      holding.release()
      await (await answered).finished()
      // It looks afresh when asked again.
      await automationsPage.suggest()
      await expect(automationsPage.suggestion('Zephyr Pet Supply')).toBeVisible()
    })

    test('says why it failed when the AI can’t be reached, and tries again', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await automationsPage.goto()
      await api.put('/ai/settings', {
        provider: 'openai',
        model: 'gpt-6-luna',
        base_url: null,
        api_key: 'not-the-key',
        review_imports: true,
      })

      await automationsPage.suggest()

      await expect(automationsPage.suggestions.getByTestId('suggestions-error')).toContainText(
        "The provider didn't accept the key",
      )
      await setUpAi(api)
      await automationsPage.suggestions.getByTestId('suggestions-again').click()
      await expect(automationsPage.suggestion('Zephyr Pet Supply')).toBeVisible()
    })

    test('nothing sent to the AI has an account number, an account name or a bank name in it', async ({
      apiAs,
      automationsPage,
      baseline,
      harness,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      // A payee that names the account and bank, and carries an account number.
      for (const number of [1, 2, 3]) {
        await addChosen(
          api,
          baseline,
          `Payment to Tartan Bank card ending in 3333 from Everyday checking ${number}`,
          'Home goods',
        )
        await addChosen(
          api,
          baseline,
          `ACCT 99887766554433 HARBOR CU TRANSFER #${number}`,
          'Home goods',
        )
      }
      await automationsPage.goto()

      await automationsPage.suggest()

      const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
      // It was asked about the payee, and the category it was put in...
      expect(sent).toContain('ZEPHYR PET SUPPLY')
      expect(sent).toContain('Home goods')
      // ...and nothing that says which account or bank.
      for (const account of Object.values(baseline.accounts)) {
        expect(sent, `${account.name} was sent`).not.toContain(account.name)
        expect(sent, `${account.institution} was sent`).not.toContain(account.institution)
        expect(sent, `${account.name}’s last digits were sent`).not.toMatch(
          new RegExp(`(?<!\\d)${account.mask}(?!\\d)`),
        )
      }
      expect(sent).not.toContain('99887766554433')
      expect(sent).not.toContain(AI_KEYS.openai)
    })
  })

  test.describe('as a viewer', () => {
    test.use({ storageState: signInFiles.viewer })

    test('has no way to, since a viewer can’t make an automation from it', async ({
      apiAs,
      automationsPage,
      baseline,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await petSupplies(api, baseline)
      await automationsPage.goto()

      await expect(automationsPage.suggestButton).toHaveCount(0)
      // And the API refuses them too.
      const viewer = await apiAs('viewer')
      await expect(viewer.post('/ai/automation-suggestions')).rejects.toThrow(/failed with 403/)
    })
  })
})
