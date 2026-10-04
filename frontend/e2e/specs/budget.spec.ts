import {
  expect,
  expectAccessible,
  signInFiles,
  simpleCsv,
  test,
  type ApiClient,
  type BaselineData,
} from '../support'

interface Budget {
  id: string
  name: string
  period: string
  amount: string
}

interface Subscription {
  id: string
}

interface Transaction {
  id: string
  payee: string
}

/** A day in the baseline household's time zone, counted from today, as YYYY-MM-DD. */
function householdDate(offset = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)!.value)
  return new Date(Date.UTC(part('year'), part('month') - 1, part('day') + offset))
    .toISOString()
    .slice(0, 10)
}

/** A month, as the Budget tab names it: "October 2026" for this month, or one `ago` months before. */
function monthName(ago = 0): string {
  const [year, month] = householdDate().split('-').map(Number) as [number, number]
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1 - ago, 1)))
}

const thisMonth = () => monthName(0)

/**
 * A monthly budget of 2,000.00 whose period began 13 days ago, so it holds every named
 * transaction of the baseline (the oldest is 13 days old) and nothing of its history (which
 * starts 15 days back), however far into the month the test runs.
 */
async function makeHome(api: ApiClient): Promise<Budget> {
  return api.post<Budget>('/budgets', {
    name: 'Home',
    period: 'monthly',
    amount: '2000.00',
    starts_on: householdDate(-13),
    today: householdDate(),
  })
}

async function category(api: ApiClient, name: string): Promise<{ id: string }> {
  const groups = await api.get<{ categories: { id: string; name: string }[] }[]>('/categories')
  const found = groups.flatMap((group) => group.categories).find((item) => item.name === name)
  if (!found) throw new Error(`The baseline is missing the ${name} category`)
  return found
}

function netflix(baseline: BaselineData) {
  return {
    name: 'Netflix',
    amount: '15.49',
    frequency: 'monthly',
    account_id: baseline.accounts.card.id,
    next_due_date: householdDate(20),
    category_id: null,
    notes: null,
    payee: 'Netflix',
    seed_transaction_id: baseline.transactions.netflix.id,
  }
}

test.describe('Budget', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('switches between the household’s budgets, each in its own kind of period', async ({
    page,
    baseline,
    budgetPage,
  }) => {
    await budgetPage.goto()
    await expect(budgetPage.cards).toHaveText([
      /Spending money\s*Weekly/,
      /Household\s*Monthly/,
      /Year plan\s*Yearly/,
    ])
    // The smallest period comes first, and is the one looked at until another is chosen.
    await expect(budgetPage.card('Spending money')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('period-title')).toContainText(/\d{4}/)
    await expectAccessible(page)

    await budgetPage.choose('Household')
    await expect(page).toHaveURL(new RegExp(`budget=${baseline.budgets.household.id}`))
    await expect(page.getByTestId('period-title')).toHaveText(thisMonth())
    await expect(page.getByTestId('period-subtitle')).toHaveText('this month')
    await expect(page.getByTestId('summary-of')).toHaveText('of $3,600.00 for the period')

    await budgetPage.choose('Year plan')
    await expect(page.getByTestId('period-title')).toHaveText(householdDate().slice(0, 4))

    // It's the one looked at when coming back.
    await page.reload()
    await expect(budgetPage.card('Year plan')).toHaveAttribute('aria-pressed', 'true')
  })

  test('looks back at earlier periods, and reads the charts as tables', async ({
    page,
    budgetPage,
  }) => {
    await budgetPage.goto()
    await budgetPage.choose('Household')
    await expect(page.getByTestId('period-back')).toHaveCount(0)

    await page.getByTestId('period-previous').click()
    await expect(page.getByTestId('period-title')).not.toHaveText(thisMonth())
    await expect(page.getByTestId('period-back')).toHaveText('Back to this month')
    await expect(page.getByTestId('period-next')).toBeEnabled()

    // The history chart ends with the period being looked at, and goes to one chosen in it.
    await page.getByTestId('history-period').nth(-3).click()
    await expect(page.getByTestId('period-title')).toHaveText(monthName(3))
    await page.getByTestId('period-back').click()
    await expect(page.getByTestId('period-title')).toHaveText(thisMonth())

    for (const [index, chart] of ['pace-chart', 'history-chart'].entries()) {
      const frame = page.getByTestId('chart-frame').nth(index)
      await frame.getByTestId('chart-view-table').click()
      await expect(frame.getByTestId('chart-table')).toBeVisible()
      await frame.getByTestId('chart-view-chart').click()
      await expect(frame.getByTestId(chart)).toBeVisible()
    }
  })

  test('makes a budget, changes it and deletes it', async ({ page, apiAs, budgetPage }) => {
    const api = await apiAs('admin')
    await budgetPage.goto()

    await budgetPage.openNew()
    await expectAccessible(page, { include: '.v-overlay--active' })
    await budgetPage.fillIn({ name: 'Pay period', period: 'biweekly', amount: '1500' })
    await budgetPage.save()

    // The new budget is looked at straight away, with nothing counting toward it yet.
    await expect(budgetPage.card('Pay period')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('budget-unset')).toContainText('Start by choosing what counts')
    await expect(budgetPage.left).toHaveText('$1,500.00')
    const [made] = (await api.get<Budget[]>('/budgets')).filter(
      (item) => item.name === 'Pay period',
    )
    expect(made).toMatchObject({ period: 'biweekly', amount: '1500.00' })

    await budgetPage.openEdit()
    await budgetPage.fillIn({ name: 'Paycheck to paycheck', amount: '1800' })
    await budgetPage.save()
    await expect(budgetPage.card('Paycheck to paycheck')).toBeVisible()
    await expect(budgetPage.left).toHaveText('$1,800.00')
    expect(
      (await api.get<Budget[]>('/budgets')).find((item) => item.id === made!.id),
    ).toMatchObject({
      name: 'Paycheck to paycheck',
      amount: '1800.00',
    })

    await page.getByTestId('budget-actions').click()
    await page.locator('.v-overlay--active').getByTestId('budget-delete').click()
    await page.getByTestId('confirm-accept').click()
    await expect(budgetPage.card('Paycheck to paycheck')).toHaveCount(0)
    await expect(budgetPage.cards).toHaveCount(3)
    expect((await api.get<Budget[]>('/budgets')).map((item) => item.name)).not.toContain(
      'Paycheck to paycheck',
    )
  })

  test('counts a paycheck as income, and every later one that arrives', async ({
    page,
    apiAs,
    baseline,
    budgetPage,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const home = await makeHome(api)

    await budgetPage.goto({ budget: home.id })
    await expect(page.getByTestId('budget-unset')).toBeVisible()
    await expect(budgetPage.left).toHaveText('$2,000.00')

    await budgetPage.openLink('income')
    // Only the money that came in is offered, and later ones are counted unless it's said not.
    await budgetPage.tick('Acme Corp')
    await expect(
      budgetPage.linkDialog.getByTestId('link-automate-switch').getByRole('checkbox'),
    ).toBeChecked()
    await expectAccessible(page, { include: '.v-overlay--active' })
    await budgetPage.add()

    await expect(budgetPage.source('Acme Corp (Home)')).toContainText(
      '$2,400.00 from 1 transaction',
    )
    await expect(budgetPage.tile('income')).toHaveText('$2,400.00')
    await expect(budgetPage.left).toHaveText('$2,000.00')
    await expect(budgetPage.transaction('Acme Corp')).toContainText('Rule: Acme Corp (Home)')

    const arrived = await api.post<Transaction>('/transactions', {
      account_id: baseline.accounts.checking.id,
      date: new Date().toISOString().slice(0, 10),
      amount: '2400.00',
      payee: 'ACME CORP',
      category_id: null,
      notes: null,
    })
    expect(arrived.payee).toBe('ACME CORP')
    await budgetPage.goto({ budget: home.id })
    await expect(budgetPage.tile('income')).toHaveText('$4,800.00')

    // It's a rule like any other, which Automations lists and can pause.
    await automationsPage.goto()
    await expect(automationsPage.card('Acme Corp (Home)')).toContainText('Income in Home')
  })

  test('counts spending by category, account, subscription and single transaction, and takes any off', async ({
    page,
    apiAs,
    baseline,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    const home = await makeHome(api)
    await api.post<Subscription>('/subscriptions', netflix(baseline))
    await budgetPage.goto({ budget: home.id })

    await budgetPage.openLink('spending')
    await budgetPage.pickIn('category', 'Groceries')
    await budgetPage.add()
    await expect(budgetPage.source('Groceries')).toContainText('$84.12 from 1 transaction')
    await expect(budgetPage.left).toHaveText('$1,915.88')

    // The card's spending that nothing else counts: the coffee and Netflix, but not the refund.
    await budgetPage.openLink('spending')
    await budgetPage.pickIn('account', 'Rewards Visa')
    await budgetPage.add()
    await expect(budgetPage.source('Rewards Visa')).toContainText('$19.99 from 2 transactions')
    await expect(budgetPage.tile('spent')).toHaveText('$104.11')

    // A subscription counts its payments ahead of the account, so Netflix moves to it.
    await budgetPage.openLink('spending')
    await budgetPage.pickIn('subscription', 'Netflix')
    await budgetPage.add()
    await expect(budgetPage.source('Rewards Visa')).toContainText('$4.50 from 1 transaction')
    await expect(budgetPage.source('Netflix')).toContainText(
      'Subscription · $15.49 from 1 transaction',
    )
    await expect(budgetPage.tile('spent')).toHaveText('$104.11')

    // One transaction on its own.
    await budgetPage.openLink('spending')
    await budgetPage.tick('Parkside Apartments')
    await budgetPage.linkDialog.getByTestId('link-automate-switch').getByRole('checkbox').uncheck()
    await budgetPage.add()
    await expect(budgetPage.transaction('Parkside Apartments')).toContainText('Linked by hand')
    await expect(budgetPage.tile('spent')).toHaveText('$1,954.11')
    await expect(budgetPage.left).toHaveText('$45.89')

    // Taking one off is only for this budget, and can be undone.
    await expect(budgetPage.transaction('Whole Foods')).toContainText('Category: Groceries')
    await budgetPage.takeOff('Whole Foods')
    await expect(budgetPage.transaction('Whole Foods')).toHaveCount(0)
    await expect(budgetPage.tile('spent')).toHaveText('$1,869.99')
    await expect(page.getByTestId('filter-removed')).toHaveText('Taken off (1)')
    await budgetPage.showTransactions('removed')
    await expect(budgetPage.transaction('Whole Foods')).toBeVisible()
    await budgetPage.transaction('Whole Foods').getByTestId('put-back').click()
    await expect(budgetPage.transaction('Whole Foods')).toHaveCount(0)
    await budgetPage.showTransactions('all')
    await expect(budgetPage.transaction('Whole Foods')).toBeVisible()
    await expect(budgetPage.tile('spent')).toHaveText('$1,954.11')

    // Stopping counting a whole category takes its transactions off, which nothing else counts.
    await budgetPage.source('Groceries').getByTestId('source-remove').click()
    await expect(budgetPage.source('Groceries')).toHaveCount(0)
    await expect(budgetPage.transaction('Whole Foods')).toHaveCount(0)
    await expect(budgetPage.tile('spent')).toHaveText('$1,869.99')
    expect((await api.get<Budget[]>('/budgets')).find((item) => item.id === home.id)).toBeDefined()
  })

  test('counts what the bank syncs and what a statement file brings in', async ({
    apiAs,
    baseline,
    budgetPage,
    connectPage,
    importPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    const home = await makeHome(api)
    // "Future only" counts what arrives after it, which is both of these.
    await api.post('/automations', {
      name: 'Corner Cafe',
      payees: ['corner cafe'],
      match: 'contains',
      counts: [{ budget_id: home.id, kind: 'spending' }],
      apply_to: 'future',
    })
    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '-6.10',
      payee: 'Corner Cafe',
      category: 'FOOD_AND_DRINK_COFFEE',
    })
    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')
    await expect(connectPage.card('Tartan Bank').getByTestId('connection-last-sync')).toContainText(
      '1 new transaction',
    )
    await importPage.goto()
    await importPage.chooseFile(
      simpleCsv('harbor-checking-cafe.csv', [
        { days_ago: 2, description: 'CORNER CAFE 0412 PORTLAND OR', amount: '-9.25' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.chooseBalance('keep')
    await importPage.importRows()
    await importPage.close()

    await budgetPage.goto({ budget: home.id })

    await expect(budgetPage.transactions).toHaveCount(2)
    for (const amount of ['6.10', '9.25']) {
      await expect(budgetPage.transactions.filter({ hasText: amount })).toContainText(
        'Rule: Corner Cafe',
      )
    }
    await expect(budgetPage.tile('spent')).toHaveText('$15.35')
    await expect(budgetPage.left).toHaveText('$1,984.65')
  })

  test('an automation made in Automations can count toward a budget as well', async ({
    apiAs,
    automationsPage,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    const home = await makeHome(api)
    const groceries = await category(api, 'Groceries')
    await api.post('/automations', {
      name: 'Whole Foods',
      payees: ['Whole Foods'],
      category_id: groceries.id,
      counts: [{ budget_id: home.id, kind: 'spending' }],
      apply_to: 'all',
    })

    await automationsPage.goto()
    await expect(automationsPage.card('Whole Foods')).toContainText('Spending in Home')
    await automationsPage.act('Whole Foods', 'edit')
    await automationsPage.next()
    await expect(automationsPage.dialog.getByTestId('automation-then')).toContainText(
      'count them as spending in Home',
    )
    await automationsPage.save()

    await budgetPage.goto({ budget: home.id })
    await expect(budgetPage.source('Whole Foods')).toContainText('$84.12 from 1 transaction')
  })
})

test.describe('Budget for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the budgets without ways to change them', async ({ page, budgetPage }) => {
    await budgetPage.goto()
    await budgetPage.choose('Household')

    await expect(page.getByTestId('read-only-notice')).toContainText(
      'Only an admin can change them',
    )
    await expect(page.getByTestId('budget-new')).toHaveCount(0)
    await expect(page.getByTestId('budget-add')).toHaveCount(0)
    await expect(page.getByTestId('budget-actions')).toHaveCount(0)
    await expect(page.getByTestId('add-income')).toHaveCount(0)
    await expect(page.getByTestId('source-remove')).toHaveCount(0)
    await expect(page.getByTestId('take-off')).toHaveCount(0)
    await expect(budgetPage.sources.first()).toBeVisible()
    await expectAccessible(page)
  })
})
