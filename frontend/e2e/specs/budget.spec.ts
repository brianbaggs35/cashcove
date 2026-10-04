import { choose, expect, signInFiles, test, type ApiClient } from '../support'

interface Category {
  id: string
  name: string
}

interface CategoryGroup {
  name: string
  kind: 'income' | 'expense' | 'transfer'
  categories: Category[]
}

interface Account {
  id: string
  name: string
}

interface BudgetConfiguration {
  category_id: string
  period: string
  amount: string | null
  account_ids: string[]
  linked_transaction_ids: string[]
  linked_subscription_ids: string[]
}

interface BudgetMonth {
  groups: {
    kind: string
    categories: { category_id: string; actual: string; budgeted: string }[]
  }[]
}

interface Transaction {
  id: string
  category_id: string | null
  account_id: string
}

interface Subscription {
  id: string
}

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

async function findCategory(api: ApiClient, name: string): Promise<Category> {
  const groups = await api.get<CategoryGroup[]>('/categories')
  const category = groups.flatMap((group) => group.categories).find((item) => item.name === name)
  if (!category) throw new Error(`The baseline is missing the ${name} category`)
  return category
}

async function findAccount(api: ApiClient, name: string): Promise<Account> {
  const accounts = await api.get<Account[]>('/accounts')
  const account = accounts.find((item) => item.name === name)
  if (!account) throw new Error(`The baseline is missing the ${name} account`)
  return account
}

function monthOf(date: string): string {
  return date.slice(0, 7)
}

function monthLine(body: BudgetMonth, categoryId: string) {
  const line = body.groups
    .flatMap((group) => group.categories)
    .find((item) => item.category_id === categoryId)
  if (!line) throw new Error(`The budget response is missing category ${categoryId}`)
  return line
}

test.describe('Budget', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('sets a weekly target for an account and shows budget progress', async ({ page, apiAs }) => {
    const api = await apiAs('admin')
    const groceries = await findCategory(api, 'Groceries')
    const checking = await findAccount(api, 'Everyday checking')
    await page.goto('/budget')

    const month = await page.getByTestId('budget-month').locator('input').inputValue()
    await page.getByTestId(`budget-edit-${groceries.id}`).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('.money-field input').fill('175')
    await choose(dialog.getByTestId('budget-period'), 'Weekly')
    await dialog.getByTestId('budget-cycle-anchor').locator('input').fill(`${month}-01`)
    await choose(dialog.getByTestId('budget-accounts'), checking.name)
    await dialog.getByTestId('budget-save').click()
    await expect(dialog).toBeHidden()

    const configuration = (
      await api.get<BudgetConfiguration[]>(`/budget/configurations?month=${month}`)
    ).find((item) => item.category_id === groceries.id)
    expect(configuration).toMatchObject({
      period: 'weekly',
      amount: '175.00',
      account_ids: [checking.id],
    })
    const line = monthLine(await api.get<BudgetMonth>(`/budget/months/${month}`), groceries.id)
    expect(Number(line.budgeted)).toBeGreaterThanOrEqual(700)
    await expect(page.getByTestId(`budget-category-${groceries.id}`)).toContainText('Weekly')
    await expect(page.getByTestId('budget-account-scope')).toContainText(checking.name)
    await expect(
      page.getByTestId(`budget-category-${groceries.id}`).getByTestId('budget-progress-bar'),
    ).toBeVisible()
  })

  test('links paycheck, bill transactions and a subscription to their budget targets', async ({
    page,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const groceries = await findCategory(api, 'Groceries')
    const paycheck = await findCategory(api, 'Paycheck')
    const checking = await findAccount(api, 'Everyday checking')
    const today = householdDate()
    const month = monthOf(today)

    await api.put(`/budget/categories/${groceries.id}`, {
      month,
      period: 'monthly',
      amount: '1000.00',
      scope: 'onward',
      rollover: false,
      account_ids: [checking.id],
    })
    await api.put(`/budget/categories/${paycheck.id}`, {
      month,
      period: 'monthly',
      amount: '4200.00',
      scope: 'onward',
      rollover: false,
      account_ids: [],
    })
    const initialMonth = await api.get<BudgetMonth>(`/budget/months/${month}`)
    const initialPaycheckActual = Number(monthLine(initialMonth, paycheck.id).actual)
    const initialGroceriesActual = Number(monthLine(initialMonth, groceries.id).actual)
    const salary = await api.post<Transaction>('/transactions', {
      account_id: checking.id,
      date: today,
      amount: '2100.00',
      payee: 'Acme payroll',
      category_id: null,
      notes: null,
    })
    const market = await api.post<Transaction>('/transactions', {
      account_id: checking.id,
      date: today,
      amount: '-35.00',
      payee: 'Neighborhood Market',
      category_id: null,
      notes: null,
    })
    const utilityPayment = await api.post<Transaction>('/transactions', {
      account_id: checking.id,
      date: today,
      amount: '-96.40',
      payee: 'City Power & Light',
      category_id: null,
      notes: null,
    })
    const utility = await api.post<Subscription>('/subscriptions', {
      name: 'City Power',
      amount: '96.40',
      frequency: 'monthly',
      account_id: checking.id,
      next_due_date: householdDate(12),
      category_id: null,
      notes: null,
      payee: 'City Power & Light',
      seed_transaction_id: utilityPayment.id,
    })

    await page.goto('/budget')
    await page.getByTestId(`budget-link-income-${paycheck.id}`).click()
    await page.getByTestId(`budget-link-${salary.id}`).click()
    await expect(page.getByTestId(`budget-unlink-${salary.id}`)).toBeVisible()
    await page.getByTestId('budget-transactions-done').click()

    await page.getByTestId(`budget-link-expense-${groceries.id}`).click()
    await page.getByTestId(`budget-link-${market.id}`).click()
    await expect(page.getByTestId(`budget-unlink-${market.id}`)).toBeVisible()
    await page.getByTestId('budget-transactions-done').click()

    await page.getByTestId(`budget-link-bills-${groceries.id}`).click()
    await expect(page.getByTestId(`budget-subscription-${utility.id}`)).toBeVisible()
    await page.getByTestId(`budget-link-subscription-${utility.id}`).click()
    await expect(page.getByTestId(`budget-unlink-subscription-${utility.id}`)).toBeVisible()

    const [monthBody, configurations] = await Promise.all([
      api.get<BudgetMonth>(`/budget/months/${month}`),
      api.get<BudgetConfiguration[]>(`/budget/configurations?month=${month}`),
    ])
    expect(Number(monthLine(monthBody, paycheck.id).actual) - initialPaycheckActual).toBeCloseTo(
      2100,
      2,
    )
    expect(Number(monthLine(monthBody, groceries.id).actual) - initialGroceriesActual).toBeCloseTo(
      131.4,
      2,
    )
    expect(
      configurations.find((item) => item.category_id === paycheck.id)?.linked_transaction_ids,
    ).toContain(salary.id)
    expect(
      configurations.find((item) => item.category_id === groceries.id)?.linked_transaction_ids,
    ).toContain(market.id)
    expect(
      configurations.find((item) => item.category_id === groceries.id)?.linked_subscription_ids,
    ).toContain(utility.id)
    expect(salary.category_id).toBeNull()
    expect(market.category_id).toBeNull()
    expect(utilityPayment.category_id).toBeNull()
  })
})
