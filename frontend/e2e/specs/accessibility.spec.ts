import type { Page } from '@playwright/test'

import {
  addChosen,
  addPayment,
  bankDate,
  bankStatementPdf,
  csvFile,
  expect,
  expectAccessible,
  holdAi,
  setUpAi,
  simpleCsv,
  TABS,
  test,
} from '../support'

const SETTINGS = [
  'general',
  'users',
  'alerts',
  'sync',
  'ai',
  'account',
  'security',
  'appearance',
  'system',
]

/** Every page of the signed-in app. */
const PAGES = [
  ...Object.keys(TABS)
    .filter((tab) => tab !== 'settings')
    .map((tab) => `/${tab}`),
  '/ai/recommendations',
  '/ai/usage',
  ...SETTINGS.map((section) => `/settings/${section}`),
]

/** What pages that load data show once they have, so axe checks the finished page. */
const LOADED: Record<string, string> = {
  '/dashboard': 'month-summary',
  '/accounts': 'net-worth',
  '/transactions': 'transaction-totals',
  '/connect': 'connection-card',
  '/import': 'import-item',
  '/categories': 'category-row',
  '/subscriptions': 'empty-state',
  '/bills': 'empty-state',
  '/automations': 'empty-state',
  '/budget': 'budget-summary',
  '/ai': 'ai-setup',
  '/ai/recommendations': 'tile-open',
  '/ai/usage': 'usage-tile-month',
}

/**
 * A bank's PDF statement for the checking account, with a payment dated a year before the days
 * it says it covers, which the AI's reading says to take another look at.
 */
const pdfStatement = () =>
  bankStatementPdf(
    'harbor-statement.pdf',
    [
      { days_ago: 10, description: 'WHOLEFDS MKT #10234 AUSTIN TX', amount: '-84.12' },
      { days_ago: 400, description: 'DELTA AIR LINES', amount: '-486.20' },
      { days_ago: 3, description: 'ACME CORP PAYROLL PPD', amount: '2400.00' },
    ],
    { period: { from: 14, to: 1 } },
  )

/** An open dialog or menu. */
const OVERLAY = '.v-overlay--active'
/** What an overlay shows, until it has finished fading out. */
const OVERLAY_CONTENT = '.v-overlay__content:visible'

async function closeOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(page.locator(OVERLAY)).toHaveCount(0)
  // Not just on its way out: clicking what opened a menu while it fades out doesn't open it again.
  await expect(page.locator(OVERLAY_CONTENT)).toHaveCount(0)
}

/** Opens each dialog or menu in turn, checks it with axe, and closes it again. */
async function expectAccessibleOverlays(
  page: Page,
  overlays: Record<string, () => Promise<void>>,
): Promise<void> {
  for (const [name, open] of Object.entries(overlays)) {
    await test.step(name, async () => {
      await open()
      await expectAccessible(page, { include: OVERLAY })
      await closeOverlay(page)
    })
  }
}

/** A viewer is told what they can't change. */
async function expectReadOnlyNotice(page: Page): Promise<void> {
  await expect(page.getByTestId('read-only-notice')).toBeVisible()
}

async function expectLoaded(page: Page, path: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  const loaded = LOADED[path]
  if (loaded) await expect(page.getByTestId(loaded).first()).toBeVisible()
}

test.describe('Accessibility', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      // The app follows the device's theme until someone picks one.
      test.use({ colorScheme })

      test('the sign-in page', async ({ signInPage, baseline }) => {
        await signInPage.goto()
        await signInPage.email.fill(baseline.users.admin.email)
        await signInPage.password.fill(baseline.users.admin.password)

        await expectAccessible(signInPage.page)
      })

      test('the invitation page', async ({ page, baseline }) => {
        await page.goto(baseline.invitations.pending.link)
        await expect(page.getByTestId('invite-email')).toBeVisible()

        await expectAccessible(page)
      })

      test('the first-run setup wizard', async ({ page, baseline }) => {
        await baseline.freshInstall()
        await page.goto('/welcome')
        await expect(page.getByTestId('welcome-start')).toBeVisible()

        await expectAccessible(page)
      })

      test('every page an admin sees', async ({ page, signInAs }) => {
        test.slow()
        await signInAs('admin')

        for (const path of PAGES) {
          await test.step(path, async () => {
            await page.goto(path)
            await expectLoaded(page, path)

            await expectAccessible(page)
          })
        }
      })

      test('the pages a viewer sees', async ({ page, signInAs }) => {
        // It visits a dozen pages and checks each, which takes a slow runner past the usual limit.
        test.slow()
        await signInAs('viewer')

        for (const path of [
          '/accounts',
          '/transactions',
          '/connect',
          '/import',
          '/subscriptions',
          '/bills',
          '/categories',
          '/automations',
          '/settings/general',
          '/settings/users',
          '/settings/ai',
        ]) {
          await test.step(path, async () => {
            await page.goto(path)
            await expectReadOnlyNotice(page)
            await expectLoaded(page, path)

            await expectAccessible(page)
          })
        }
      })

      test('the account menu and the invite dialog', async ({ page, signInAs, shell }) => {
        await signInAs('admin')
        await page.goto('/settings/users')

        await page.getByTestId('invite-open').click()
        await expectAccessible(page, { include: OVERLAY })
        await closeOverlay(page)

        await shell.accountMenu.click()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the account dialogs and menu', async ({ page, signInAs, accountsPage }) => {
        await signInAs('admin')
        await accountsPage.goto()

        await expectAccessibleOverlays(page, {
          'adding an account': () => accountsPage.addButton.click(),
          "an account's menu": () =>
            accountsPage.row('Everyday checking').getByTestId('account-actions').click(),
          'editing a linked account': () => accountsPage.act('Rewards Visa', 'edit'),
          'confirming a closing': () => accountsPage.act('Everyday checking', 'close'),
        })
      })

      test('the transaction dialogs', async ({ page, signInAs, transactionsPage }) => {
        await signInAs('admin')
        await transactionsPage.goto()

        await expectAccessibleOverlays(page, {
          'adding a transaction': () => transactionsPage.addButton.click(),
          'editing one': () => transactionsPage.open('Whole Foods'),
          'one from a bank': () => transactionsPage.open('Blue Bottle Coffee'),
          'the filters': () => transactionsPage.openFilters(),
        })
      })

      test('the transaction details dialog', async ({ page, signInAs, transactionsPage }) => {
        // Desktop admins open the edit form directly; only phones have this details dialog.
        test.skip(test.info().project.name !== 'mobile', 'Phones open transaction details first')
        await signInAs('admin')
        await transactionsPage.goto()

        await expectAccessibleOverlays(page, {
          'viewing transaction details': () => transactionsPage.openDetails('Whole Foods'),
        })
      })

      test('categorizing a selection', async ({ page, signInAs, transactionsPage }) => {
        // Phones list transactions without the table's checkboxes, so there's nothing to select.
        test.skip(test.info().project.name === 'mobile', 'Only computers select several at once')
        await signInAs('admin')
        await transactionsPage.goto()
        await transactionsPage.select('Venmo', 'Whole Foods')

        await expectAccessible(page)
        await transactionsPage.bulkBar.getByTestId('bulk-categorize').click()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the connect wizard, and each bank’s dialogs and menu', async ({
        page,
        signInAs,
        connectPage,
        plaid,
      }) => {
        await signInAs('admin')
        await connectPage.goto()

        await expectAccessibleOverlays(page, {
          'the connect wizard': () => connectPage.addButton.click(),
          'choosing a new bank’s accounts': async () => {
            await connectPage.startConnecting()
            await plaid.connect('platypus')
            await expect(connectPage.accountRows).toHaveCount(3)
          },
          "a bank's menu": () =>
            connectPage.card('Tartan Bank').getByTestId('connection-actions').click(),
          'choosing a connected bank’s accounts': () => connectPage.act('Tartan Bank', 'choose'),
          'the sync history': async () => {
            await connectPage.act('Tartan Bank', 'history')
            await expect(connectPage.history.getByTestId('sync-history-item').first()).toBeVisible()
          },
          'removing a bank': () => connectPage.act('Tartan Bank', 'remove'),
        })
      })

      test('the import dialog, and the saved formats’ dialogs and menu', async ({
        page,
        baseline,
        signInAs,
        importPage,
      }) => {
        await signInAs('admin')
        await importPage.goto()
        const statement = simpleCsv('harbor-checking.csv', [
          { days_ago: 1, description: 'NORTHWIND HEALTH PAYROLL PPD', amount: '1875.00' },
          { days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' },
        ])

        await expectAccessibleOverlays(page, {
          'matching a file’s columns': () =>
            importPage.chooseFile(
              csvFile(
                'credit-union.csv',
                ['Date', 'Description', 'Amount', 'Type'],
                [[bankDate(1), 'NORTHWIND HEALTH PAYROLL', '1875.00', 'CR']],
              ),
            ),
          'reviewing its rows': async () => {
            await importPage.chooseFile(statement)
            await importPage.continue()
            await importPage.chooseAccount('Everyday checking')
          },
          'a file that can’t be read': () =>
            importPage.chooseFile({
              name: 'statement.pdf',
              mimeType: 'application/pdf',
              buffer: Buffer.from('%PDF-1.7\n'),
            }),
          "a saved format's menu": () =>
            importPage
              .format(baseline.saved_formats.maple_card.name)
              .getByTestId('saved-format-actions')
              .click(),
          'renaming a saved format': async () => {
            await importPage
              .format(baseline.saved_formats.maple_card.name)
              .getByTestId('saved-format-actions')
              .click()
            await page.locator(OVERLAY).getByTestId('saved-format-rename').click()
          },
          'undoing an import': () =>
            importPage
              .importItem(baseline.imports.checking_history.file_name)
              .getByTestId('import-item-undo')
              .click(),
        })
      })

      test('the automation dialogs and a card’s menu', async ({
        page,
        signInAs,
        apiAs,
        automationsPage,
      }) => {
        const api = await apiAs('admin')
        const groups =
          await api.get<{ categories: { id: string; name: string }[] }[]>('/categories')
        const gifts = groups
          .flatMap((group) => group.categories)
          .find((category) => category.name === 'Gifts & donations')!
        await api.post('/automations', {
          name: 'Venmo payments',
          payees: ['Venmo'],
          category_id: gifts.id,
          apply_to: 'future',
        })
        await signInAs('admin')
        await automationsPage.goto()

        await expectAccessibleOverlays(page, {
          'a new automation': () => automationsPage.addButton.click(),
          'a new automation with a transaction ticked': async () => {
            await automationsPage.addButton.click()
            await automationsPage.findIn({ payees: ['Whole Foods'] })
          },
          'fine-tuning what a new automation matches': async () => {
            await automationsPage.addButton.click()
            await automationsPage.findIn({
              payees: ['Whole Foods'],
              match: 'Contains',
              account: 'Everyday checking',
              amount: { from: '80', to: '90' },
            })
          },
          'what a new automation does': async () => {
            await automationsPage.addButton.click()
            await automationsPage.fillIn({ payees: ['Whole Foods'], category: 'Restaurants' })
          },
          'an automation’s menu': () =>
            automationsPage.card('Venmo payments').getByTestId('automation-actions').click(),
          'changing an automation': () => automationsPage.act('Venmo payments', 'edit'),
          'deleting an automation': () => automationsPage.act('Venmo payments', 'delete'),
        })
      })

      test('the subscription dialogs', async ({ page, signInAs, apiAs, baseline }) => {
        const api = await apiAs('admin')
        await api.post('/subscriptions', {
          name: 'Netflix Plus',
          amount: '15.49',
          frequency: 'monthly',
          account_id: baseline.accounts.card.id,
          next_due_date: new Date().toISOString().slice(0, 10),
          category_id: null,
          notes: null,
          payee: 'Netflix',
          seed_transaction_id: null,
        })
        await signInAs('admin')
        await page.goto('/subscriptions')
        const card = page.getByTestId('subscription-card')
        await expect(card).toBeVisible()

        await expectAccessibleOverlays(page, {
          'a subscription’s menu': () => card.getByTestId('subscription-actions').click(),
          'adding a subscription': () => page.getByTestId('subscription-add').click(),
          'linking payments': () => card.getByTestId('subscription-link-payments').click(),
        })
      })

      test('the bill dialogs', async ({ page, signInAs, apiAs, baseline, billsPage }) => {
        const api = await apiAs('admin')
        await api.post('/bills', {
          name: 'City Power',
          amount: '96.40',
          amount_varies: true,
          frequency: 'monthly',
          account_id: baseline.accounts.checking.id,
          // Past due, so the page also shows what warns of that.
          next_due_date: new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10),
          category_id: baseline.categories.Utilities.id,
          notes: null,
          payee: 'City Power & Light',
          seed_transaction_id: baseline.transactions.power.id,
        })
        await signInAs('admin')
        await billsPage.goto()
        await expect(billsPage.cards).toHaveCount(1)
        await expect(billsPage.overdueAlert).toBeVisible()

        await expectAccessibleOverlays(page, {
          'a bill’s menu': () => billsPage.cards.first().getByTestId('bill-actions').click(),
          'adding a bill': () => billsPage.addButton.click(),
          'linking payments': () =>
            billsPage.cards.first().getByTestId('bill-link-payments').click(),
        })
      })

      test('the budget dialogs, menu and charts', async ({ page, signInAs, budgetPage }) => {
        await signInAs('admin')
        await budgetPage.goto()
        await budgetPage.choose('Household')

        await expectAccessibleOverlays(page, {
          'a new budget': () => budgetPage.openNew(),
          'changing a budget': () => budgetPage.openEdit(),
          'a budget’s menu': () => page.getByTestId('budget-actions').click(),
          'adding income': () => budgetPage.openLink('income'),
          'adding spending from an account': async () => {
            await budgetPage.openLink('spending')
            await budgetPage.chooseTab('account')
          },
          'deleting a budget': async () => {
            await page.getByTestId('budget-actions').click()
            await page.locator(OVERLAY).getByTestId('budget-delete').click()
          },
        })
        // The charts as tables, which is how their numbers are read without the picture.
        for (const index of [0, 1]) {
          await page.getByTestId('chart-frame').nth(index).getByTestId('chart-view-table').click()
        }
        await expectAccessible(page)
      })

      test('the AI pages once AI is set up and has been used', async ({
        page,
        signInAs,
        apiAs,
        aiPage,
        aiSettingsPage,
      }) => {
        test.slow()
        await setUpAi(await apiAs('admin'))
        await signInAs('admin')

        // A conversation, what the AI suggested about the transactions, and what it cost.
        await aiPage.goto('ask')
        await aiPage.ask('How am I doing against my budgets?')
        await expectAccessible(page)
        await aiPage.goto('recommendations')
        await aiPage.review()
        await expect(aiPage.suggestions.first()).toBeVisible()
        await expectAccessible(page)
        await aiPage.goto('usage')
        await expect(aiPage.modelRow('GPT-6 Luna (OpenAI)')).toBeVisible()
        await expectAccessible(page)
        await aiSettingsPage.goto()
        await expect(aiSettingsPage.status).toHaveText('On · GPT-6 Luna')
        await expectAccessible(page)
        await aiSettingsPage.chooseProvider('ollama_local')
        await expect(aiSettingsPage.address).toBeVisible()
        await expectAccessible(page)
      })

      test('the AI dialogs and menus', async ({
        page,
        signInAs,
        apiAs,
        aiPage,
        aiSettingsPage,
        importPage,
      }) => {
        await setUpAi(await apiAs('admin'))
        await signInAs('admin')

        await aiPage.goto('recommendations')
        await expectAccessibleOverlays(page, {
          'asking for a review': () => aiPage.reviewButton.click(),
        })
        // What is shared opens in the page, not over it.
        await aiPage.goto('ask')
        await page.getByTestId('ai-privacy-toggle').click()
        await expect(page.getByTestId('ai-privacy')).toContainText('What the AI is told')
        await expectAccessible(page)
        await aiSettingsPage.goto()
        await expectAccessibleOverlays(page, {
          'the models': () => aiSettingsPage.model.locator('.v-field').click(),
          'turning AI off': () => aiSettingsPage.offButton.click(),
        })
        await importPage.goto()
        await expectAccessibleOverlays(page, {
          'the AI’s look at an import': async () => {
            await importPage.chooseFile(
              simpleCsv('coffee.csv', [
                { days_ago: 2, description: 'STARBUCKS STORE 1234', amount: '-5.25' },
                { days_ago: 3, description: 'LA TAQUERIA', amount: '-23.80' },
              ]),
            )
            await importPage.continue()
            await importPage.chooseAccount('Everyday checking')
            await importPage.importRowsForAi()
          },
        })
      })

      test('a statement given to the AI chat, while it is read and once it has been', async ({
        page,
        signInAs,
        apiAs,
        aiPage,
        importPage,
      }) => {
        test.slow()
        await setUpAi(await apiAs('admin'), 'openai', { reviewImports: false })
        await signInAs('admin')
        await aiPage.goto('ask')
        // Before anything is said, the welcome offers to read one.
        await expect(aiPage.statementOffer).toBeVisible()
        await expectAccessible(page)

        // While the AI works on a question, which says so.
        const answer = await holdAi(page, 'chat')
        await aiPage.input.fill('How am I doing against my budgets?')
        await aiPage.send.click()
        await expect(aiPage.busy).toBeVisible()
        await expectAccessible(page)
        answer.release()
        await expect(aiPage.busy).toHaveCount(0)

        // While the AI reads a statement, and once it has, with a row that needs another look.
        const reading = await holdAi(page, 'statements')
        await page.getByTestId('chat-file').setInputFiles(pdfStatement())
        await expect(aiPage.statement).toHaveAttribute('data-status', 'reading')
        await expectAccessible(page)
        reading.release()
        await expect(aiPage.statement).toHaveAttribute('data-status', 'done')
        await expectAccessible(page)

        // Its review, and the dialog for correcting a row, over it.
        await aiPage.reviewStatement()
        await expect(importPage.row('Delta Air Lines').getByTestId('review-row-flag')).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })
        const cancelTarget = await page.getByTestId('import-cancel').boundingBox()
        expect(cancelTarget?.width).toBeGreaterThanOrEqual(44)
        expect(cancelTarget?.height).toBeGreaterThanOrEqual(44)
        await importPage.row('Delta Air Lines').getByTestId('review-row-edit').click()
        await expect(importPage.rowDialog).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the import dialog while the AI reads a PDF, and once it has', async ({
        page,
        signInAs,
        apiAs,
        importPage,
      }) => {
        await setUpAi(await apiAs('admin'), 'openai', { reviewImports: false })
        await signInAs('admin')
        await importPage.goto()
        const reading = await holdAi(page, 'statements')

        await page.getByTestId('file-input').setInputFiles(pdfStatement())
        await expect(importPage.dialog.getByTestId('statement-progress')).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })
        reading.release()
        await expect(importPage.dialog.getByTestId('import-review')).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })
      })

      test('a PDF that needs AI', async ({ page, signInAs, importPage }) => {
        await signInAs('admin')
        await importPage.goto()
        await expectAccessibleOverlays(page, {
          'a PDF chosen with AI off': () => importPage.chooseFile(pdfStatement()),
        })
      })

      test('finding transactions in plain words, while the AI works and once it has', async ({
        page,
        signInAs,
        apiAs,
        transactionsPage,
      }) => {
        test.slow()
        await setUpAi(await apiAs('admin'))
        await signInAs('admin')
        await transactionsPage.goto()
        // The button beside the filters.
        await expect(transactionsPage.aiButton).toBeVisible()
        await expectAccessible(page)

        await transactionsPage.aiButton.click()
        await expect(transactionsPage.aiSearch).toBeVisible()
        await expectAccessible(page)

        // While the AI works out the filters.
        const working = await holdAi(page, 'search')
        await transactionsPage.aiSearch
          .getByTestId('ai-search-input')
          .getByRole('textbox')
          .fill('uncategorized hobbies for a birthday')
        await transactionsPage.aiSearch.getByTestId('ai-search-find').click()
        await expect(transactionsPage.aiSearch.getByTestId('ai-search-working')).toBeVisible()
        await expectAccessible(page)

        // What it found, with what it couldn't use, and the chips for the filters.
        working.release()
        await expect(transactionsPage.aiResult).toBeVisible()
        await expect(transactionsPage.aiIgnored).toBeVisible()
        await expectAccessible(page)

        // And when there was nothing in it to filter by.
        await transactionsPage.findWithAi('something blue')
        await expect(transactionsPage.aiNothing).toBeVisible()
        await expectAccessible(page)
      })

      test('the automations the AI suggests, while it looks and once it has, and the form for one', async ({
        page,
        signInAs,
        apiAs,
        baseline,
        automationsPage,
      }) => {
        test.slow()
        const api = await apiAs('admin')
        await setUpAi(api)
        for (const number of [1, 2, 3, 4]) {
          await addChosen(api, baseline, `ZEPHYR PET SUPPLY #330${number}`, 'Home goods', {
            amount: '-23.50',
            daysAgo: number,
          })
        }
        await addPayment(api, baseline, 'ZEPHYR PET SUPPLY #3399', { amount: '-9.00', daysAgo: 6 })
        for (const number of [1, 2, 3]) {
          await addChosen(api, baseline, `HEARTH BAKERY #77${number}`, 'Coffee', {
            amount: '-6.25',
            daysAgo: 10 + number,
          })
        }
        // An older automation that gives some of them another category, which is warned of.
        await api.post('/automations', {
          name: 'Everything is groceries',
          payees: ['hearth'],
          match: 'contains',
          category_id: baseline.categories.Groceries.id,
          apply_to: 'future',
        })
        await signInAs('admin')
        await automationsPage.goto()
        await expect(automationsPage.suggestButton).toBeVisible()
        await expectAccessible(page)

        const looking = await holdAi(page, 'automation-suggestions')
        await automationsPage.suggestButton.click()
        await expect(automationsPage.suggestions.getByTestId('suggestions-working')).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })

        looking.release()
        await expect(automationsPage.suggestionCards.first()).toBeVisible()
        await expect(automationsPage.suggestions.getByTestId('suggestion-overlap')).toBeVisible()
        await expectAccessible(page, { include: OVERLAY })

        await automationsPage.makeFromSuggestion('Zephyr Pet Supply')
        await expectAccessible(page, { include: OVERLAY })
      })

      test('the category dialogs', async ({ page, signInAs, categoriesPage }) => {
        await signInAs('admin')
        await categoriesPage.goto()

        await expectAccessibleOverlays(page, {
          'adding a group': () => categoriesPage.addGroupButton.click(),
          'adding a category': () => categoriesPage.addCategory('Food & drink'),
          'deleting a category transactions use': () =>
            categoriesPage.actOnCategory('Groceries', 'delete'),
        })
      })
    })
  }
})
