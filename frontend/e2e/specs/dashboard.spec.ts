import {
  expect,
  expectAccessible,
  signInFiles,
  test,
  usd,
  type ApiClient,
  type BaselineData,
} from '../support'

interface DashboardData {
  month: { income: string; spent: string; start: string }
  days: number
  categories: { category_id: string | null; amount: string; count: number }[]
  payees: { payee: string; amount: string }[]
  uncategorized: number
}

interface Created {
  id: string
}

/** A day in the baseline household's time zone, counted from today, as YYYY-MM-DD. */
function householdDate(days = 0): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days))
    .toISOString()
    .slice(0, 10)
}

/** What was left over once the month's spending came out of its income, in dollars. */
function leftOver(data: DashboardData): number {
  return (
    (Math.round(Number(data.month.income) * 100) - Math.round(Number(data.month.spent) * 100)) / 100
  )
}

function payment(baseline: BaselineData, payee: string, amount: string, categoryId: string | null) {
  return {
    account_id: baseline.accounts.checking.id,
    date: householdDate(),
    amount,
    payee,
    category_id: categoryId,
    notes: null,
  }
}

function recurring(baseline: BaselineData, name: string, dueInDays: number) {
  return {
    name,
    amount: '48.00',
    amount_varies: false,
    frequency: 'monthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: householdDate(dueInDays),
    category_id: null,
    notes: null,
    // Not what anything is called, so no payment is linked to it.
    payee: `Nobody called ${name}`,
    seed_transaction_id: null,
  }
}

function dashboardOf(api: ApiClient, today: string): Promise<DashboardData> {
  return api.get<DashboardData>(`/dashboard?today=${today}`)
}

test.describe('Dashboard', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('is first in the navigation', async ({ page, shell }) => {
    await page.goto('/accounts')
    await shell.showMenu()

    const first = shell.sideMenu.getByRole('list', { name: 'Sections' }).getByRole('link').first()
    await expect(first).toHaveText('Dashboard')
    await first.click()

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible()
  })

  test('shows how the month is going, across every account', async ({
    apiAs,
    baseline,
    dashboardPage,
    accountsPage,
  }) => {
    const api = await apiAs('admin')
    await dashboardPage.goto()
    const today = await dashboardPage.today()
    const before = await dashboardOf(api, today)

    await api.post(
      '/transactions',
      payment(baseline, 'Dashboard Payroll', '3000.00', baseline.categories.Paycheck.id),
    )
    await api.post(
      '/transactions',
      payment(baseline, 'Dashboard Grocer', '-120.00', baseline.categories.Groceries.id),
    )
    await dashboardPage.goto()

    // What came in and went out is the API's own count, which the baseline's own transactions
    // this month are part of: the two new ones are what changed.
    const after = await dashboardOf(api, today)
    expect(Number(after.month.income) - Number(before.month.income)).toBe(3000)
    expect(Number(after.month.spent) - Number(before.month.spent)).toBe(120)
    await expect(dashboardPage.figure('income')).toHaveText(usd(after.month.income))
    await expect(dashboardPage.figure('spent')).toHaveText(usd(after.month.spent))
    await expect(dashboardPage.figure('saved')).toHaveText(usd(leftOver(after)))
    await expect(dashboardPage.change('income')).toContainText('last month')
    const dayOfMonth = Number(today.slice(8))
    await expect(dashboardPage.month.getByTestId('month-day')).toHaveText(
      `Day ${dayOfMonth} of ${after.days}`,
    )

    // The same net worth the Accounts tab adds up.
    const netWorth = await dashboardPage.netWorth.innerText()
    await accountsPage.goto()
    await expect(accountsPage.netWorth).toHaveText(netWorth)
  })

  test('shows where the money went, and each payee it went to', async ({
    page,
    apiAs,
    baseline,
    dashboardPage,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    await api.post(
      '/transactions',
      payment(baseline, 'Dashboard Grocer', '-9999.00', baseline.categories.Groceries.id),
    )
    await dashboardPage.goto()
    const spending = await dashboardOf(api, await dashboardPage.today())

    // The biggest category and the biggest payee come first, each with what it came to.
    const [biggest] = spending.categories
    expect(biggest!.category_id).toBe(baseline.categories.Groceries.id)
    await expect(dashboardPage.spendingParts.first()).toContainText('Groceries')
    await expect(dashboardPage.spendingParts.first()).toContainText(usd(biggest!.amount))
    await expect(dashboardPage.page.getByTestId('spending-total')).toHaveText(
      usd(spending.month.spent),
    )
    await expect(dashboardPage.topPayees.first()).toContainText('Dashboard Grocer')
    await expect(dashboardPage.topPayees.first()).toContainText(usd('9999.00'))

    // Choosing a payee looks at what was spent with it this month.
    await dashboardPage.topPayees.first().getByRole('link').click()
    await expect(page).toHaveURL(/\/transactions\?/)
    await expect(transactionsPage.rows).toHaveCount(1)
    await expect(transactionsPage.rows.first()).toContainText('Dashboard Grocer')
  })

  test('points out what needs attention, and goes to it', async ({
    page,
    dashboardPage,
    transactionsPage,
  }) => {
    await dashboardPage.goto()

    // Venmo has no category yet, and Fidelity wants someone to sign in again.
    await expect(page.getByTestId('attention-uncategorized')).toContainText('no category yet')
    await expect(page.getByTestId('attention-banks')).toContainText('1 bank needs attention')

    await page.getByTestId('attention-review').click()
    await expect(page).toHaveURL(/\/transactions\?category=none$/)
    await expect(transactionsPage.rows.filter({ hasText: 'Venmo' })).toBeVisible()

    await dashboardPage.goto()
    await page.getByTestId('attention-connect').click()
    await expect(page).toHaveURL(/\/connect$/)
  })

  test('lists the budgets, and what is coming up or overdue', async ({
    page,
    apiAs,
    baseline,
    dashboardPage,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    await api.post<Created>('/bills', recurring(baseline, 'Dashboard Water', 3))
    await api.post<Created>('/subscriptions', recurring(baseline, 'Dashboard Gym', -2))
    await api.post<Created>('/subscriptions', recurring(baseline, 'Dashboard Later', 60))

    await dashboardPage.goto()

    // What is due after the next two weeks isn't listed yet; what is overdue comes first.
    await expect(dashboardPage.comingUp).toHaveCount(2)
    await expect(dashboardPage.comingUp.first()).toContainText('Dashboard Gym')
    await expect(dashboardPage.comingUp.first()).toContainText('Overdue by 2 days')
    await expect(dashboardPage.comingUp.last()).toContainText('Dashboard Water')
    await expect(dashboardPage.comingUp.last()).toContainText('Due in 3 days')
    await expect(dashboardPage.comingUp.last()).toContainText(usd('48.00'))

    // Every budget is there with how much of it is left.
    for (const budget of Object.values(baseline.budgets)) {
      await expect(dashboardPage.budget(budget.name)).toBeVisible()
      await expect(dashboardPage.budget(budget.name)).toContainText(usd(budget.amount))
    }
    await dashboardPage.budget(baseline.budgets.household.name).getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/budget\\?budget=${baseline.budgets.household.id}`))
    await expect(budgetPage.summary).toBeVisible()

    await dashboardPage.goto()
    await dashboardPage.comingUp.last().getByRole('link').click()
    await expect(page).toHaveURL(/\/bills$/)
  })

  test('shows the latest transactions with where they link', async ({
    page,
    baseline,
    dashboardPage,
    transactionsPage,
  }) => {
    await dashboardPage.goto()

    await expect(dashboardPage.recent).toHaveCount(6)
    // The card Blue Bottle Coffee was paid with, from today, is the newest.
    await expect(dashboardPage.recent.first()).toContainText('Blue Bottle Coffee')
    await expect(dashboardPage.recent.first()).toContainText(baseline.accounts.card.name)
    await expect(dashboardPage.recent.first()).toContainText('-$4.50')

    await page.getByTestId('recent-transactions').getByTestId('dashboard-card-link').click()
    await expect(page).toHaveURL(/\/transactions$/)
    await expect(transactionsPage.totals).toBeVisible()
  })

  test('has charts that can be read as tables', async ({ page, dashboardPage }) => {
    await dashboardPage.goto()
    await expect(dashboardPage.cashFlowMonths).toHaveCount(6)
    await expect(dashboardPage.cashFlowMonths.last()).toHaveAccessibleName(
      /income .*, spent .*, (saved|overspent) /,
    )
    await expectAccessible(page)

    for (const [chart, rows] of [
      ['cash-flow', 'cash-flow-row'],
      ['spending-breakdown', 'spending-row'],
    ] as const) {
      await page.getByTestId(chart).getByTestId('chart-view-table').click()
      await expect(page.getByTestId(rows).first()).toBeVisible()
    }
    await expect(page.getByTestId('cash-flow-row')).toHaveCount(6)
    await expectAccessible(page)
  })

  test('says what a month came to when it is tabbed to or pointed at', async ({
    dashboardPage,
  }) => {
    await dashboardPage.goto()
    const tip = dashboardPage.page.getByTestId('cash-flow-tip')
    await expect(tip).toHaveCount(0)

    // The keyboard reaches each month, as pointing at it does.
    await dashboardPage.cashFlowMonths.last().focus()

    await expect(tip).toContainText('income')
    await expect(tip).toContainText('spent')
    await dashboardPage.cashFlowMonths.first().focus()
    await expect(tip).toHaveCount(1)
    await dashboardPage.cashFlowMonths.first().blur()
    await expect(tip).toHaveCount(0)
  })

  test('starts a household with no accounts off with ways to add some', async ({
    page,
    apiAs,
    baseline,
    dashboardPage,
  }) => {
    const api = await apiAs('admin')
    for (const account of Object.values(baseline.accounts)) {
      await api.delete(`/accounts/${account.id}`)
    }

    await page.goto('/dashboard')

    const welcome = page.getByTestId('dashboard-welcome')
    await expect(welcome).toContainText('Your dashboard starts with an account')
    await expect(welcome.getByRole('link')).toHaveText([
      'Add an account',
      'Import a statement',
      'Connect a bank',
    ])
    await expect(dashboardPage.month).toHaveCount(0)
    await expectAccessible(page)

    await page.getByTestId('dashboard-add-account').click()
    await expect(page).toHaveURL(/\/accounts$/)
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      // The app follows the device's theme until someone picks one.
      test.use({ colorScheme })

      test('fits the screen and is accessible', async ({ dashboardPage }) => {
        await dashboardPage.goto()
        await expect(dashboardPage.cashFlowMonths).toHaveCount(6)

        expect(await dashboardPage.overflowsSideways()).toBe(false)
        await expectAccessible(dashboardPage.page)
      })

      test('draws its charts in the theme’s own colours', async ({ dashboardPage }) => {
        await dashboardPage.goto()

        const colours = await dashboardPage.page.getByTestId('cash-flow').evaluate((card) => {
          const style = getComputedStyle(card.querySelector('.chart')!)
          return ['--chart-income', '--chart-spent'].map((name) =>
            style.getPropertyValue(name).trim(),
          )
        })
        expect(colours).toEqual(
          colorScheme === 'dark' ? ['#3987e5', '#d95926'] : ['#2a78d6', '#eb6834'],
        )
        // The bars themselves wear them: Vuetify's chart takes its colour from the card's.
        const bar = dashboardPage.page.locator('[data-test="cash-flow"] .flow__layer--income svg')
        await expect(bar).toHaveCSS(
          'color',
          colorScheme === 'dark' ? 'rgb(57, 135, 229)' : 'rgb(42, 120, 214)',
        )
      })
    })
  }
})

test.describe('Dashboard for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows everything an admin sees', async ({ dashboardPage }) => {
    await dashboardPage.goto()

    await expect(dashboardPage.netWorth).toBeVisible()
    await expect(dashboardPage.budgets).toHaveCount(3)
    await expect(dashboardPage.recent.first()).toBeVisible()
    await expect(dashboardPage.cashFlowMonths).toHaveCount(6)
    // Nothing on it changes anything, so there is no read-only notice either.
    await expect(dashboardPage.page.getByTestId('read-only-notice')).toHaveCount(0)
    await expectAccessible(dashboardPage.page)
  })
})
