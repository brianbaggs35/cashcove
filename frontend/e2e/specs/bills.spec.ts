import {
  choose,
  dateOf,
  expect,
  expectAccessible,
  signInFiles,
  simpleCsv,
  test,
  type ApiClient,
  type BaselineData,
} from '../support'

interface Bill {
  id: string
  name: string
  kind: 'bill' | 'subscription'
  amount: string
  amount_varies: boolean
  active: boolean
  category_id: string | null
  payment_count: number
  last_payment_on: string | null
  last_payment_amount: string | null
  expected_amount: string
  next_due_date: string
}

interface Transaction {
  id: string
  payee: string
  category_id: string | null
  subscription_id: string | null
}

interface TransactionPage {
  items: Transaction[]
}

interface Budget {
  id: string
}

function dateInDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
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

/** What the API takes to make a bill, which is paid from checking unless said otherwise. */
function newBill(baseline: BaselineData, name: string, more: Record<string, unknown> = {}) {
  return {
    name,
    amount: '96.40',
    amount_varies: false,
    frequency: 'monthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: householdDate(20),
    category_id: null,
    notes: null,
    // Not what anything is called, so only what links payments to it does.
    payee: `Nobody called ${name}`,
    seed_transaction_id: null,
    ...more,
  }
}

async function linkedPayments(api: ApiClient, billId: string): Promise<Transaction[]> {
  const page = await api.get<TransactionPage>(`/transactions?subscription_id=${billId}`)
  return page.items
}

async function search(api: ApiClient, text: string): Promise<Transaction[]> {
  const page = await api.get<TransactionPage>(`/transactions?q=${encodeURIComponent(text)}`)
  return page.items
}

test.describe('Bills', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('opens from the navigation, under Subscriptions, and starts empty', async ({
    page,
    shell,
    billsPage,
  }) => {
    await page.goto('/subscriptions')
    await shell.open('bills')

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bills')
    await expect(page.getByTestId('empty-state')).toContainText('Never miss a due date')
    await expect(billsPage.addButton).toHaveText(/Add your first bill/)
    await expectAccessible(page)
  })

  test('is made from the payment that paid it, and links every payment like it, past and future', async ({
    page,
    baseline,
    apiAs,
    billsPage,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const power = baseline.transactions.power
    const utilities = baseline.categories.Utilities
    await billsPage.goto()
    await billsPage.addButton.click()

    // Choosing the payment fills in who it was to, how much, and its category.
    await billsPage.fillIn({
      name: 'City Power',
      account: 'Everyday checking',
      payment: 'City Power',
      varies: true,
      dueDate: householdDate(20),
    })
    await expect(billsPage.dialog.getByTestId('bill-amount').getByRole('textbox')).toHaveValue(
      '96.40',
    )
    await expect(billsPage.dialog.getByTestId('bill-payee').getByRole('textbox')).toHaveValue(
      'City Power & Light',
    )
    await expect(billsPage.dialog.getByTestId('bill-category')).toContainText('Utilities')
    await expectAccessible(page, { include: '.v-overlay--active' })
    await billsPage.save()

    const card = billsPage.card('City Power')
    await expect(card.getByTestId('bill-payment-count')).toContainText('1 payment tracked')
    await expect(card.getByTestId('category-chip')).toContainText('Utilities')
    await expect(card.getByTestId('bill-varies')).toHaveText('Amount varies')
    const [bill] = await api.get<Bill[]>('/bills')
    expect(bill).toMatchObject({ kind: 'bill', amount_varies: true, payment_count: 1 })
    expect(bill!.category_id).toBe(utilities.id)
    // It is a bill, so it isn't one of the subscriptions.
    expect(await api.get<Bill[]>('/subscriptions')).toEqual([])
    expect((await linkedPayments(api, bill!.id)).map((item) => item.id)).toEqual([power.id])

    // Whatever arrives later is linked as it does, and settles the next due date.
    const arrived = await api.post<Transaction>('/transactions', {
      account_id: baseline.accounts.checking.id,
      date: householdDate(),
      amount: '-101.25',
      payee: 'City Power & Light',
      category_id: null,
      notes: null,
    })
    expect(arrived.subscription_id).toBe(bill!.id)
    expect(arrived.category_id).toBe(utilities.id)
    await page.reload()
    await expect(card.getByTestId('bill-payment-count')).toContainText('2 payments tracked')
    await expect(card.getByTestId('bill-last-payment')).toContainText('$101.25')
    const updated = await api.get<Bill>(`/bills/${bill!.id}`)
    expect(updated.last_payment_on).toBe(householdDate())
    // The average of what it has come to, since the amount changes every time.
    expect(updated.expected_amount).toBe('98.83')

    await card.getByTestId('bill-view-payments').click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*subscription=${bill!.id}`))
    await expect(page.getByTestId('filter-chip-subscription')).toContainText('City Power payments')
    await expect(transactionsPage.row('City Power & Light').first()).toBeVisible()
  })

  test('is kept apart from subscriptions, though both link payments the same way', async ({
    page,
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    await api.post('/bills', newBill(baseline, 'City Power'))
    await api.post('/subscriptions', newBill(baseline, 'Streamflix', { amount: '14.99' }))

    await billsPage.goto()
    await expect(billsPage.cards).toHaveCount(1)
    await expect(billsPage.card('City Power')).toBeVisible()
    await expect(page.getByTestId('bills-count')).toContainText('Active bills')
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)

    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscription-card')).toHaveCount(1)
    await expect(page.getByTestId('subscription-title')).toHaveText('Streamflix')
    await expect(billsPage.cards).toHaveCount(0)

    // A bill isn't there to open as a subscription, or the other way round.
    const [bill] = await api.get<Bill[]>('/bills')
    await expect(api.get(`/subscriptions/${bill!.id}`)).rejects.toThrow(/failed with 404/)
  })

  test('a payment from any account is linked by hand, settles the due date and is taken off again', async ({
    page,
    baseline,
    apiAs,
    billsPage,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const venmo = baseline.transactions.venmo
    const paid = dateOf(venmo)
    // Due two days before the payment, which is from checking rather than the card it's paid with.
    const bill = await api.post<Bill>(
      '/bills',
      newBill(baseline, 'Roommate share', {
        amount: '40.00',
        account_id: baseline.accounts.card.id,
        next_due_date: dateInDays(paid, -2),
      }),
    )
    await billsPage.goto()
    const card = billsPage.card('Roommate share')
    await expect(card.getByTestId('bill-payment-count')).toContainText('0 payments tracked')
    await expect(card.getByTestId('bill-due')).toContainText('Overdue')
    await expect(billsPage.overdueAlert).toContainText(
      '1 bill is past its due date without a payment linked.',
    )

    await card.getByTestId('bill-link-payments').click()
    const dialog = page.getByTestId('bill-payments-dialog')
    await expect(dialog.getByTestId('payments-summary')).toContainText('0 payments linked.')
    await dialog.getByTestId('finder-search').getByRole('searchbox').fill('Venmo')
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await expectAccessible(page, { include: '.v-overlay--active' })
    await dialog.getByTestId(`payment-link-${venmo.id}`).click()
    await expect(dialog.getByTestId('payments-summary')).toContainText('1 payment linked.')
    await expect(dialog.getByTestId(`payment-unlink-${venmo.id}`)).toBeVisible()

    const linked = await api.get<Bill>(`/bills/${bill.id}`)
    expect(linked.payment_count).toBe(1)
    expect(linked.last_payment_on).toBe(paid)
    // The payment settled the due date, which moved a month on.
    expect(linked.next_due_date > paid).toBe(true)

    await dialog.getByTestId('payments-done').click()
    await expect(dialog).toBeHidden()
    await expect(card.getByTestId('bill-payment-count')).toContainText('1 payment tracked')
    await expect(card.getByTestId('bill-due')).not.toContainText('Overdue')
    await expect(billsPage.overdueAlert).toHaveCount(0)

    // The transaction says which bill it paid, and can be moved off it from there.
    await transactionsPage.goto({ q: 'Venmo' })
    await transactionsPage.openDetails('Venmo')
    await expect(
      transactionsPage.infoDialog.getByTestId('transaction-info-subscription-select'),
    ).toContainText('Roommate share')
    await page.keyboard.press('Escape')

    await billsPage.goto()
    await card.getByTestId('bill-link-payments').click()
    await dialog.getByTestId('payments-scope').getByRole('button', { name: 'Linked here' }).click()
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await dialog.getByTestId(`payment-unlink-${venmo.id}`).click()
    await expect(dialog.getByTestId('payments-summary')).toContainText('0 payments linked.')
    expect(await linkedPayments(api, bill.id)).toEqual([])
  })

  test('a payment is linked to a bill from its details, moved off it and taken off again', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const venmo = baseline.transactions.venmo
    const bill = await api.post<Bill>(
      '/bills',
      newBill(baseline, 'Rent share', { next_due_date: dateInDays(dateOf(venmo), -2) }),
    )
    const subscription = await api.post<Bill>(
      '/subscriptions',
      newBill(baseline, 'Streamflix', { amount: '14.99' }),
    )

    await transactionsPage.goto({ q: 'Venmo' })
    await transactionsPage.openDetails('Venmo')
    const field = transactionsPage.infoDialog.getByTestId('transaction-info-subscription-select')
    await expectAccessible(page, { include: '.v-overlay--active' })
    // One list for both, in a group each.
    await choose(field, 'Rent share')

    await expect(page.getByText('Linked it to Rent share')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBe(bill.id)
    const linked = await api.get<Bill>(`/bills/${bill.id}`)
    expect(linked.payment_count).toBe(1)
    expect(linked.next_due_date > dateOf(venmo)).toBe(true)

    // Moved to a subscription instead, since a payment is only one of them.
    await choose(field, 'Streamflix')
    await expect(page.getByText('Linked it to Streamflix')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBe(
      subscription.id,
    )
    expect((await api.get<Bill>(`/bills/${bill.id}`)).payment_count).toBe(0)

    // Taken off again, it's just a transaction.
    await field.getByRole('button', { name: 'Clear Subscription or bill' }).click()
    await expect(page.getByText('Took it off the subscription')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBeNull()
  })

  test('selected payments are linked to a bill together', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    // The list only offers ticking several transactions on a computer, so phones skip this one.
    test.skip(test.info().project.name === 'mobile', 'Only computers select several at once')
    const api = await apiAs('admin')
    const bill = await api.post<Bill>('/bills', newBill(baseline, 'Shared costs'))
    const subscription = await api.post<Bill>(
      '/subscriptions',
      newBill(baseline, 'Streamflix', { amount: '14.99' }),
    )
    const venmo = baseline.transactions.venmo
    const groceries = baseline.transactions.groceries

    await transactionsPage.goto()
    await transactionsPage.select('Venmo', 'Whole Foods')
    await transactionsPage.bulkBar.getByTestId('bulk-link').click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('link-apply') })
    await expectAccessible(page, { include: '.v-overlay--active' })
    // One list, in a group each, since a payment is a subscription's or a bill's.
    await choose(dialog.getByTestId('link-target'), 'Shared costs')
    await dialog.getByTestId('link-apply').click()
    await expect(dialog).toBeHidden()

    await expect(page.getByText('Linked 2 payments to Shared costs')).toBeVisible()
    for (const payment of [venmo, groceries]) {
      expect((await api.get<Transaction>(`/transactions/${payment.id}`)).subscription_id).toBe(
        bill.id,
      )
    }
    expect((await api.get<Bill>(`/bills/${bill.id}`)).payment_count).toBe(2)
    expect((await api.get<Bill>(`/subscriptions/${subscription.id}`)).payment_count).toBe(0)
  })

  test('is changed, paused and deleted, and warns by its own reminder settings', async ({
    page,
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    await api.post<Bill>(
      '/bills',
      newBill(baseline, 'City Power', { next_due_date: householdDate(4) }),
    )
    await billsPage.goto()
    // Bills warn five days ahead until settings say otherwise, where subscriptions warn three.
    await expect(billsPage.dueAlert).toContainText(
      '1 payment is due within your 5-day reminder window.',
    )
    await expect(billsPage.card('City Power').getByTestId('bill-due-alert')).toContainText(
      'Payment due within your 5-day reminder window.',
    )

    await page.goto('/settings/alerts')
    const billRow = page.getByTestId('alert-bill')
    await expect(billRow.getByRole('textbox', { name: "Days before it's due" })).toHaveValue('5')
    await expect(
      page.getByTestId('alert-subscription').getByRole('textbox', { name: "Days before it's due" }),
    ).toHaveValue('3')
    await billRow.getByRole('textbox', { name: "Days before it's due" }).fill('2')
    await page.getByTestId('save-bar').getByTestId('save').click()
    await expect(page.getByTestId('save-bar')).toHaveCount(0)

    await billsPage.goto()
    await expect(billsPage.dueAlert).toHaveCount(0)
    await expect(billsPage.card('City Power').getByTestId('bill-due-alert')).toHaveCount(0)

    await billsPage.act('City Power', 'edit')
    await billsPage.fillIn({ name: 'Electric', notes: 'Budget billing' })
    await billsPage.save()
    await expect(billsPage.card('Electric')).toBeVisible()
    expect((await api.get<Bill[]>('/bills'))[0]!.name).toBe('Electric')

    await billsPage.act('Electric', 'toggle')
    await page.getByTestId('bill-filter').getByRole('button', { name: 'Paused' }).click()
    await expect(billsPage.card('Electric').getByTestId('bill-paused-chip')).toBeVisible()
    expect((await api.get<Bill[]>('/bills?active=false'))[0]?.active).toBe(false)
    await billsPage.act('Electric', 'toggle')
    await page.getByTestId('bill-filter').getByRole('button', { name: 'Active' }).click()
    await expect(billsPage.card('Electric')).toBeVisible()

    await billsPage.act('Electric', 'delete')
    await page.getByTestId('confirm-accept').click()
    await expect(billsPage.cards).toHaveCount(0)
    expect(await api.get<Bill[]>('/bills')).toEqual([])
  })

  test('the category follows the bill, and a deleted category leaves it uncategorized', async ({
    baseline,
    apiAs,
    billsPage,
    categoriesPage,
  }) => {
    const api = await apiAs('admin')
    const power = baseline.transactions.power
    const utilities = baseline.categories.Utilities
    const phone = baseline.categories['Phone & internet']
    const bill = await api.post<Bill>(
      '/bills',
      newBill(baseline, 'City Power', {
        payee: 'City Power & Light',
        category_id: utilities.id,
        seed_transaction_id: power.id,
      }),
    )
    expect(bill.category_id).toBe(utilities.id)

    // Deleting the category with somewhere to move it takes the bill there with its payments.
    await categoriesPage.goto()
    await categoriesPage.deleteCategory('Utilities', { moveTo: 'Phone & internet' })
    expect((await api.get<Bill>(`/bills/${bill.id}`)).category_id).toBe(phone.id)
    expect((await api.get<Transaction>(`/transactions/${power.id}`)).category_id).toBe(phone.id)
    await billsPage.goto()
    await expect(billsPage.card('City Power').getByTestId('category-chip')).toContainText(
      'Phone & internet',
    )

    // Deleting it with nothing to move to leaves them with no category, as the default.
    await categoriesPage.goto()
    await categoriesPage.deleteCategory('Phone & internet')
    expect((await api.get<Bill>(`/bills/${bill.id}`)).category_id).toBeNull()
    expect((await api.get<Transaction>(`/transactions/${power.id}`)).category_id).toBeNull()
    await billsPage.goto()
    await expect(billsPage.card('City Power').getByTestId('category-chip')).toHaveText(
      'Uncategorized',
    )
  })

  test('counts toward a budget, as spending, like a subscription', async ({
    apiAs,
    baseline,
    budgetPage,
  }) => {
    const api = await apiAs('admin')
    const power = baseline.transactions.power
    await api.post<Bill>(
      '/bills',
      newBill(baseline, 'City Power', {
        payee: 'City Power & Light',
        seed_transaction_id: power.id,
      }),
    )
    // Begun 13 days ago, so it holds every named transaction of the baseline and none of its history.
    const home = await api.post<Budget>('/budgets', {
      name: 'Home',
      period: 'monthly',
      amount: '2000.00',
      starts_on: householdDate(-13),
      today: householdDate(),
    })
    await budgetPage.goto({ budget: home.id })

    await budgetPage.openLink('spending')
    await expect(budgetPage.linkDialog.getByTestId('link-tab-bill')).toHaveText('A bill')
    await budgetPage.pickIn('bill', 'City Power')
    await budgetPage.add()

    await expect(budgetPage.source('City Power')).toContainText('Bill · $96.40 from 1 transaction')
    await expect(budgetPage.transaction('City Power & Light')).toContainText('Bill: City Power')
    await expect(budgetPage.tile('spent')).toHaveText('$96.40')
    await expect(budgetPage.left).toHaveText('$1,903.60')
  })

  test('an automation links a bill’s payments from the bank and from a statement file', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
    connectPage,
    importPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    // Due soon, so the payments that arrive settle it.
    const bill = await api.post<Bill>(
      '/bills',
      newBill(baseline, 'City Power', { next_due_date: householdDate(5) }),
    )

    // Neither the bank nor the statement file calls it what the bill does, so an automation does.
    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.findIn({ texts: ['city power'], match: 'Contains' })
    await automationsPage.next()
    await expectAccessible(page, { include: '.v-overlay--active' })
    await automationsPage.thenFill({ name: 'Electricity', bill: 'City Power', applyTo: 'future' })
    await automationsPage.save()
    await expect(
      automationsPage.card('Electricity').getByTestId('automation-subscription'),
    ).toHaveText('City Power')
    const [automation] = await api.get<{ subscription_id: string | null }[]>('/automations')
    expect(automation!.subscription_id).toBe(bill.id)
    // It covers what arrives from now on, so the baseline's payment from before is left alone.
    expect((await api.get<Bill>(`/bills/${bill.id}`)).payment_count).toBe(0)

    await plaid.addTransaction({
      account_id: baseline.accounts.card.id,
      amount: '-101.25',
      payee: 'City Power & Light',
      category: 'RENT_AND_UTILITIES_GAS_AND_ELECTRICITY',
    })
    await connectPage.goto()
    await connectPage.syncNow('Tartan Bank')
    await expect(connectPage.card('Tartan Bank').getByTestId('connection-last-sync')).toContainText(
      '1 new transaction',
    )
    expect((await api.get<Bill>(`/bills/${bill.id}`)).payment_count).toBe(1)

    await importPage.goto()
    await importPage.chooseFile(
      simpleCsv('harbor-checking-power.csv', [
        { days_ago: 2, description: 'CITY POWER & LIGHT 0412 AUSTIN TX', amount: '-88.10' },
        { days_ago: 3, description: 'LA TAQUERIA', amount: '-23.80' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.chooseBalance('keep')
    await importPage.importRows()
    await importPage.close()

    const updated = await api.get<Bill>(`/bills/${bill.id}`)
    expect(updated.payment_count).toBe(2)
    const linked = await linkedPayments(api, bill.id)
    expect(linked.map((item) => item.payee).sort()).toEqual([
      'CITY POWER & LIGHT 0412 AUSTIN TX',
      'City Power & Light',
    ])
    // What the automation doesn't look for is left as it came, and the bill is paid up.
    const [other] = await search(api, 'taqueria')
    expect(other!.subscription_id).toBeNull()
    expect(updated.next_due_date > bill.next_due_date).toBe(true)
  })

  test('has nothing running off the side of the screen, on a phone or a computer', async ({
    page,
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    await api.post('/bills', newBill(baseline, 'City Power', { next_due_date: householdDate(-2) }))
    await api.post('/bills', newBill(baseline, 'Phone', { amount: '55.00' }))

    await billsPage.goto()

    await expect(billsPage.cards).toHaveCount(2)
    await expect(billsPage.overdueAlert).toBeVisible()
    // Nothing runs off the side of the screen.
    const width = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      window: window.innerWidth,
    }))
    expect(width.page).toBeLessThanOrEqual(width.window)
    await expectAccessible(page)
  })
})

test.describe('Bills for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the bills without ways to change them', async ({
    page,
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    await api.post('/bills', newBill(baseline, 'City Power'))

    await billsPage.goto()

    await expect(page.getByTestId('read-only-notice')).toContainText(
      'Only an admin can change them',
    )
    await expect(billsPage.card('City Power')).toBeVisible()
    await expect(billsPage.addButton).toHaveCount(0)
    await expect(page.getByTestId('bill-actions')).toHaveCount(0)
    await expect(page.getByTestId('bill-link-payments')).toHaveCount(0)
    await expect(page.getByTestId('bill-view-payments')).toBeVisible()
    await expectAccessible(page)
  })

  test('cannot change a bill through the API either', async ({ baseline, apiAs }) => {
    const admin = await apiAs('admin')
    const bill = await admin.post<Bill>('/bills', newBill(baseline, 'City Power'))
    const viewer = await apiAs('viewer')

    expect((await viewer.get<Bill[]>('/bills')).map((item) => item.id)).toEqual([bill.id])
    await expect(viewer.post('/bills', newBill(baseline, 'Another'))).rejects.toThrow(
      /failed with 403/,
    )
    await expect(viewer.patch(`/bills/${bill.id}`, { name: 'Changed' })).rejects.toThrow(
      /failed with 403/,
    )
    await expect(viewer.delete(`/bills/${bill.id}`)).rejects.toThrow(/failed with 403/)
    expect((await admin.get<Bill>(`/bills/${bill.id}`)).name).toBe('City Power')
  })
})
