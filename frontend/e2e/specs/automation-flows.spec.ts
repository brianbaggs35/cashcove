import {
  expect,
  expectAccessible,
  signInFiles,
  simpleCsv,
  test,
  type ApiClient,
  type BaselineData,
} from '../support'

interface Category {
  id: string
  name: string
}

interface CategoryGroup {
  categories: Category[]
}

interface Budget {
  id: string
}

interface Bill {
  id: string
  payment_count: number
  last_payment_on: string | null
}

interface Transaction {
  id: string
  payee: string
  amount: string
  category_id: string | null
  subscription_id: string | null
}

interface TransactionPage {
  items: Transaction[]
}

async function category(api: ApiClient, name: string): Promise<Category> {
  const groups = await api.get<CategoryGroup[]>('/categories')
  const found = groups.flatMap((group) => group.categories).find((item) => item.name === name)
  if (!found) throw new Error(`The baseline is missing the ${name} category`)
  return found
}

async function transactionsFor(api: ApiClient, text: string): Promise<Transaction[]> {
  const page = await api.get<TransactionPage>(`/transactions?q=${encodeURIComponent(text)}`)
  return page.items
}

/** A budget with nothing counted toward it yet, so only what an automation counts shows. */
function newBudget(api: ApiClient, name: string): Promise<Budget> {
  return api.post<Budget>('/budgets', { name, period: 'yearly', amount: '5000.00' })
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

function newBill(baseline: BaselineData, name: string) {
  return {
    name,
    amount: '96.40',
    amount_varies: true,
    frequency: 'monthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: householdDate(20),
    category_id: null,
    notes: null,
    // Not what anything is called, so only an automation links payments to it.
    payee: `Nobody called ${name}`,
    seed_transaction_id: null,
  }
}

/** An employer that pays, and a shop of nearly the same name that is paid. */
const PAYCHECK = 'ACME PAYROLL 0412 DIRECT DEP'
const PURCHASE = 'ACME STORE 0412 PORTLAND OR'

test.describe('Automations on what comes in', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a paycheck in a statement file is classified, counted in the budget and told about', async ({
    page,
    apiAs,
    automationsPage,
    importPage,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    const paycheck = await category(api, 'Paycheck')
    const budget = await newBudget(api, 'Paycheck tracker')

    // The automations page says what it does: classify a paycheck, and count it in a budget.
    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.fillIn({
      texts: ['acme payroll'],
      match: 'Contains',
      direction: 'Money in',
      name: 'Paycheck',
      category: 'Paycheck',
      incomeBudgets: ['Paycheck tracker'],
      applyTo: 'future',
    })
    await expect(automationsPage.dialog.getByTestId('automation-when')).toHaveText(
      'Payee contains “acme payroll”, in any account, money in',
    )
    await expect(automationsPage.dialog.getByTestId('automation-then')).toHaveText(
      'put them in 💼 Paycheck and count them as income in Paycheck tracker',
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await automationsPage.save()

    const card = automationsPage.card('Paycheck')
    await expect(card.getByTestId('automation-direction')).toHaveText('Money in')
    await expect(card.getByTestId('category-chip')).toContainText('Paycheck')
    await expect(card.getByTestId('automation-budget')).toHaveText('Income in Paycheck tracker')

    // A statement file with the paycheck, what was bought from a shop of nearly the name, and a lunch.
    await importPage.goto()
    await importPage.chooseFile(
      simpleCsv('harbor-checking-pay.csv', [
        { days_ago: 0, description: PAYCHECK, amount: '2500.00' },
        { days_ago: 1, description: PURCHASE, amount: '-45.00' },
        { days_ago: 2, description: 'LA TAQUERIA', amount: '-23.80' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')

    // The review says what the automation will do before anything is imported.
    await expect(importPage.dialog.getByTestId('review-sorted')).toHaveText(
      'Your automations will sort 1 of the new transactions as they come in.',
    )
    const row = importPage.row('ACME PAYROLL')
    await expect(row.getByTestId('review-row-automation')).toHaveText('Sorted by your automations')
    await expect(row.getByTestId('category-chip')).toContainText('Paycheck')
    // Money going out to the same name is left alone.
    await expect(importPage.row('ACME STORE').getByTestId('review-row-automation')).toHaveCount(0)
    await expect(importPage.row('LA TAQUERIA').getByTestId('review-row-automation')).toHaveCount(0)
    await expectAccessible(page, { include: '.v-overlay--active' })

    await importPage.chooseBalance('keep')
    await importPage.importRows()
    await expect(importPage.dialog.getByTestId('import-done-note')).toContainText(
      'Your automations sorted 1 of them.',
    )
    await importPage.close()

    const [paid] = await transactionsFor(api, 'ACME PAYROLL')
    const [bought] = await transactionsFor(api, 'ACME STORE')
    expect(paid!.category_id).toBe(paycheck.id)
    expect(bought!.category_id).toBeNull()

    // The paycheck counts in the budget through the automation; the purchase doesn't.
    await budgetPage.goto({ budget: budget.id })
    await expect(budgetPage.source('Paycheck')).toContainText('$2,500.00 from 1 transaction')
    await expect(budgetPage.transaction('ACME PAYROLL')).toContainText('Rule: Paycheck')
    await expect(budgetPage.transaction('ACME STORE')).toHaveCount(0)
    await expect(budgetPage.tile('income')).toHaveText('$2,500.00')
  })

  test('a paycheck from the bank is classified and counted in the budget as it syncs', async ({
    apiAs,
    baseline,
    connectPage,
    budgetPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    const paycheck = await category(api, 'Paycheck')
    const budget = await newBudget(api, 'Paycheck tracker')
    await api.post('/automations', {
      name: 'Paycheck',
      payees: ['acme payroll'],
      match: 'contains',
      direction: 'in',
      category_id: paycheck.id,
      counts: [{ budget_id: budget.id, kind: 'income' }],
      apply_to: 'future',
    })
    // The stand-in's only banks are Tartan's card and Fidelity's 401(k), so that is where it pays.
    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '2500.00',
      payee: 'ACME PAYROLL',
    })
    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '-45.00',
      payee: 'ACME STORE',
    })

    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')

    await expect(connectPage.card('Tartan Bank').getByTestId('connection-last-sync')).toContainText(
      '2 new transactions',
    )
    const [paid] = await transactionsFor(api, 'ACME PAYROLL')
    const [bought] = await transactionsFor(api, 'ACME STORE')
    expect(paid!.category_id).toBe(paycheck.id)
    expect(bought!.category_id).not.toBe(paycheck.id)
    await budgetPage.goto({ budget: budget.id })
    await expect(budgetPage.source('Paycheck')).toContainText('$2,500.00 from 1 transaction')
    await expect(budgetPage.transaction('ACME PAYROLL')).toContainText('Rule: Paycheck')
    await expect(budgetPage.transaction('ACME STORE')).toHaveCount(0)
  })

  test('an automation links payments to a bill, from a statement file as well as the bank', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
    importPage,
    billsPage,
    connectPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    const bill = await api.post<Bill>('/bills', newBill(baseline, 'Water'))

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.fillIn({
      texts: ['metro water'],
      match: 'Contains',
      direction: 'Money out',
      name: 'Metro Water',
      bill: 'Water',
      applyTo: 'future',
    })
    await automationsPage.save()
    await expect(
      automationsPage.card('Metro Water').getByTestId('automation-subscription'),
    ).toHaveText('Water')

    await importPage.goto()
    await importPage.chooseFile(
      simpleCsv('harbor-checking-water.csv', [
        { days_ago: 3, description: 'METRO WATER DISTRICT 0412', amount: '-61.20' },
        { days_ago: 4, description: 'LA TAQUERIA', amount: '-23.80' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await expect(importPage.row('METRO WATER').getByTestId('review-row-automation')).toHaveText(
      'Sorted by your automations · linked to Water',
    )
    await importPage.chooseBalance('keep')
    await importPage.importRows()
    await importPage.close()

    // The bill from the card, as the bank reports it.
    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '-58.75',
      payee: 'Metro Water District',
    })
    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')
    await expect(connectPage.card('Tartan Bank').getByTestId('connection-last-sync')).toContainText(
      '1 new transaction',
    )

    const linked = await transactionsFor(api, 'Metro Water')
    expect(linked.map((item) => item.subscription_id)).toEqual([bill.id, bill.id])
    expect((await api.get<Bill>(`/bills/${bill.id}`)).payment_count).toBe(2)
    await billsPage.goto()
    await expect(billsPage.card('Water')).toContainText('2 payments tracked')
    await expectAccessible(page)
  })

  test('taking a budget off an automation stops it counting there', async ({
    apiAs,
    baseline,
    automationsPage,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    const paycheck = await category(api, 'Paycheck')
    const budget = await newBudget(api, 'Paycheck tracker')
    await api.post('/transactions', {
      account_id: baseline.accounts.checking.id,
      date: householdDate(),
      amount: '1000.00',
      payee: 'Acme Payroll',
      category_id: null,
      notes: null,
    })
    await api.post('/automations', {
      name: 'Paycheck',
      payees: ['Acme Payroll'],
      direction: 'in',
      category_id: paycheck.id,
      counts: [{ budget_id: budget.id, kind: 'income' }],
      apply_to: 'all',
    })
    await budgetPage.goto({ budget: budget.id })
    await expect(budgetPage.tile('income')).toHaveText('$1,000.00')

    await automationsPage.goto()
    await automationsPage.act('Paycheck', 'edit')
    await automationsPage.next()
    await automationsPage.dialog
      .getByTestId('automation-income-budgets')
      .locator('.v-chip__close')
      .click()
    await automationsPage.save()

    await expect(automationsPage.card('Paycheck').getByTestId('automation-budget')).toHaveCount(0)
    await budgetPage.goto({ budget: budget.id })
    await expect(budgetPage.tile('income')).toHaveText('$0.00')
  })

  test('a category chosen by hand is kept when an automation is paused, resumed or changed', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const gifts = await category(api, 'Gifts & donations')
    const restaurants = await category(api, 'Restaurants')
    const venmo = baseline.transactions.venmo
    await api.post('/automations', {
      name: 'Venmo',
      payees: ['Venmo'],
      category_id: gifts.id,
      apply_to: 'all',
    })
    const sorted = await api.get<Transaction & { category_id: string }>(`/transactions/${venmo.id}`)
    expect(sorted.category_id).toBe(gifts.id)
    // Someone says it was lunch, which the automation doesn't know.
    await api.patch(`/transactions/${venmo.id}`, { category_id: restaurants.id })

    // Paused and resumed, it sorts everything it covers again when it comes back.
    await automationsPage.goto()
    await automationsPage.act('Venmo', 'toggle')
    await expect(automationsPage.cards).toHaveCount(0)
    await page.getByTestId('automation-filter').getByRole('button', { name: 'Paused' }).click()
    await automationsPage.act('Venmo', 'toggle')
    await page.getByTestId('automation-filter').getByRole('button', { name: 'Active' }).click()
    await expect(automationsPage.card('Venmo')).toBeVisible()

    const after = await api.get<Transaction>(`/transactions/${venmo.id}`)
    expect(after.category_id).toBe(restaurants.id)
  })
})
