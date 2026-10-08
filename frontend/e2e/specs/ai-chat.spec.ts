import { AI_KEYS, addChosen, expect, setUpAi, signInFiles, test } from '../support'

test.describe('Asking the AI', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('the AI tab says to set AI up first, and nothing else needs it', async ({
      page,
      aiPage,
      transactionsPage,
    }) => {
      await aiPage.goto()

      await expect(aiPage.setup).toContainText('AI isn’t set up')
      await expect(aiPage.setup).toContainText('Cashcove works the same without it')
      await expect(aiPage.setupLink).toHaveAttribute('href', '/settings/ai')
      await expect(aiPage.input).toHaveCount(0)

      // Everything else works the same, with no AI in sight.
      await page.goto('/dashboard')
      await expect(page.getByTestId('month-summary')).toBeVisible()
      await expect(page.getByTestId('attention-ai')).toHaveCount(0)
      await transactionsPage.goto()
      await expect(transactionsPage.rows.first()).toBeVisible()

      await aiPage.goto()
      await aiPage.setupLink.click()
      await expect(page).toHaveURL(/\/settings\/ai$/)
    })

    test('asks a question and gets an answer drawn from the records', async ({ aiPage, apiAs }) => {
      await setUpAi(await apiAs('admin'))
      await aiPage.goto()

      await expect(aiPage.welcome).toContainText('Ask about your money')
      await expect(aiPage.privacy).toContainText(
        'Account numbers, account names and bank names are never sent to the AI.',
      )
      await aiPage.ask('How much did I spend on coffee?')

      await expect(aiPage.messages.first()).toContainText('How much did I spend on coffee?')
      // The test server's stand-in says how many recent transactions it was given, and what
      // it was asked.
      await expect(aiPage.messages.last()).toContainText(
        /I can see [1-9]\d* recent transactions\. You asked: How much did I spend on coffee\?/,
      )
      await expect(aiPage.welcome).toHaveCount(0)

      await aiPage.clear.click()
      await expect(aiPage.messages).toHaveCount(0)
      await expect(aiPage.welcome).toBeVisible()
    })

    test('a suggested question can be asked with a tap', async ({ aiPage, apiAs }) => {
      await setUpAi(await apiAs('admin'), 'anthropic')
      await aiPage.goto()

      await aiPage.questions.first().click()

      await expect(aiPage.messages).toHaveCount(2)
      await expect(aiPage.messages.last()).toContainText(
        'You asked: How much did I spend on groceries last month?',
      )
    })

    test('a chat change stays pending until the admin approves it', async ({ aiPage, apiAs }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await aiPage.goto()

      await aiPage.ask('Create a Vacation budget of $200 a month')

      const budgetsBefore = await api.get<{ name: string }[]>('/budgets')
      expect(budgetsBefore.some((budget) => budget.name === 'Vacation')).toBe(false)
      await expect(aiPage.proposal).toContainText('Vacation')
      await expect(aiPage.proposal.getByTestId('proposal-status')).toHaveText('Pending approval')

      await aiPage.approveProposal()

      const budgetsAfter = await api.get<{ name: string }[]>('/budgets')
      expect(budgetsAfter.some((budget) => budget.name === 'Vacation')).toBe(true)
    })

    test('asks for missing subscription details and keeps account names out of the AI request', async ({
      aiPage,
      apiAs,
      baseline,
      harness,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await aiPage.goto()

      await aiPage.ask('Help me create a new subscription for Nebula Stream')
      await expect(aiPage.messages.last()).toContainText(
        "I couldn't find any payments to Nebula Stream",
      )
      await expect(aiPage.messages.last()).toContainText('How much is Nebula Stream')

      const nextDue = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      await aiPage.ask(
        `It's $9.99 monthly, next due ${nextDue}, from ${baseline.accounts.checking.name}.`,
      )

      await expect(aiPage.proposal).toContainText('Nebula Stream')
      await expect(aiPage.proposal).toContainText(baseline.accounts.checking.name)
      await expect(aiPage.proposal.getByTestId('proposal-status')).toHaveText('Pending approval')

      const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
      expect(sent).not.toContain(baseline.accounts.checking.name)
      expect(sent).toMatch(/<ACCOUNT_[bcdfghjkmnpqrstvwxz]{10}>/)
    })

    test('rejecting with context keeps the card and asks the AI to revise it', async ({
      aiPage,
      apiAs,
      baseline,
      harness,
    }) => {
      const api = await apiAs('admin')
      await addChosen(api, baseline, 'NETFLIX.COM', 'Subscriptions', {
        amount: '-15.49',
        daysAgo: 30,
      })
      await setUpAi(api)
      await aiPage.goto()
      await aiPage.ask('Create a new subscription for Netflix')
      await expect(aiPage.proposal).toContainText('Netflix')

      const nextDue = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      const reason = `Make it $17.99 yearly, next due ${nextDue}, from ${baseline.accounts.checking.name}.`
      await aiPage.rejectProposal(reason)
      await expect(aiPage.busy).toHaveCount(0)
      await expect(aiPage.messages).toHaveCount(4)
      await expect(aiPage.proposals).toHaveCount(2)
      await expect(aiPage.proposal.getByTestId('proposal-status')).toHaveText('Pending approval')
      await expect(aiPage.proposal).toContainText('17.99 USD')
      await expect(aiPage.proposal).toContainText('annual')

      const history = await api.get<{
        items: { state: string; note: string | null }[]
      }>('/ai/proposals?state=rejected')
      expect(history.items).toHaveLength(1)
      expect(history.items[0]).toMatchObject({ state: 'rejected', note: reason })

      const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
      expect(sent).not.toContain(baseline.accounts.checking.name)
      expect(sent).toMatch(/<ACCOUNT_[bcdfghjkmnpqrstvwxz]{10}>/)
    })

    test('nothing sent to an AI has an account number, an account name or a bank name in it', async ({
      aiPage,
      apiAs,
      baseline,
      harness,
    }) => {
      const api = await apiAs('admin')
      await setUpAi(api)
      await aiPage.goto()

      // Someone asking with all of it in the question.
      await aiPage.ask(
        'What did I pay on my Rewards Visa ending 3333 at Tartan Bank? Is acct 4417123456789010 the same one?',
      )

      const sent = (await harness.aiRequests()).map((request) => request.body).join('\n')
      // It did ask the AI, with what the household spent...
      expect(sent).toContain('Whole Foods')
      // ...and nothing that says which account or bank.
      for (const account of Object.values(baseline.accounts)) {
        expect(sent, `${account.name} was sent`).not.toContain(account.name)
        expect(sent, `${account.institution} was sent`).not.toContain(account.institution)
        expect(sent, `${account.name}’s last digits were sent`).not.toMatch(
          new RegExp(`(?<!\\d)${account.mask}(?!\\d)`),
        )
      }
      for (const text of [
        '4417123456789010',
        'Tartan Rewards Visa Signature',
        'Fidelity 401(k) Plan',
      ]) {
        expect(sent, `${text} was sent`).not.toContain(text)
      }
      // And the key went only where it belongs: in a header, never in what was asked.
      expect(sent).not.toContain(AI_KEYS.openai)
    })

    test('says what to fix when the key isn’t accepted, and answers once it is', async ({
      aiPage,
      apiAs,
    }) => {
      const api = await apiAs('admin')
      await api.put('/ai/settings', {
        provider: 'openai',
        model: 'gpt-6-luna',
        base_url: null,
        api_key: 'not-the-key',
        review_imports: true,
      })
      await aiPage.goto()

      await aiPage.input.fill('How am I doing against my budgets?')
      await aiPage.send.click()

      await expect(aiPage.error).toContainText("The provider didn't accept the key")
      // The question is back in the box, so it isn't lost.
      await expect(aiPage.input).toHaveValue('How am I doing against my budgets?')

      await setUpAi(api)
      await aiPage.retry.click()

      await expect(aiPage.messages.last()).toContainText(
        'You asked: How am I doing against my budgets?',
      )
      await expect(aiPage.error).toHaveCount(0)
    })
  })
})
