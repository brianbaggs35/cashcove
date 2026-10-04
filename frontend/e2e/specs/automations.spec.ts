import {
  dateOf,
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

interface Automation {
  id: string
  name: string
  payees: string[]
  match: 'exact' | 'starts_with' | 'contains'
  min_amount: string | null
  max_amount: string | null
  active: boolean
  apply_to: 'all' | 'future'
  category_id: string | null
  subscription_id: string | null
  matching_count: number
}

interface Subscription {
  id: string
  payment_count: number
  next_due_date: string
  typical_amount: string | null
  expected_amount: string
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

async function category(api: ApiClient, name: string): Promise<Category> {
  const groups = await api.get<CategoryGroup[]>('/categories')
  const found = groups.flatMap((group) => group.categories).find((item) => item.name === name)
  if (!found) throw new Error(`The baseline is missing the ${name} category`)
  return found
}

async function transaction(api: ApiClient, id: string): Promise<Transaction> {
  return api.get<Transaction>(`/transactions/${id}`)
}

/** What the transactions search finds for some text, which is any payee that has it. */
async function search(api: ApiClient, text: string): Promise<Transaction[]> {
  const page = await api.get<TransactionPage>(`/transactions?q=${encodeURIComponent(text)}`)
  return page.items
}

async function transactionsFor(api: ApiClient, payee: string): Promise<Transaction[]> {
  const found = await search(api, payee)
  return found.filter((item) => item.payee.toLowerCase() === payee.toLowerCase())
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function shift(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function newPayment(baseline: BaselineData, payee: string, amount = '-12.00') {
  return {
    account_id: baseline.accounts.checking.id,
    date: today(),
    amount,
    payee,
    category_id: null,
    notes: null,
  }
}

function newSubscription(
  baseline: BaselineData,
  name: string,
  amount: string,
  more: Record<string, unknown> = {},
) {
  return {
    name,
    amount,
    frequency: 'monthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: shift(today(), 5),
    category_id: null,
    notes: null,
    // Not what anything is called, so only automations link payments to it.
    payee: `Nobody called ${name}`,
    seed_transaction_id: null,
    ...more,
  }
}

test.describe('Automations', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin picks a transaction and sorts every one like it, past and future', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const gifts = await category(api, 'Gifts & donations')
    const venmo = baseline.transactions.venmo
    expect(venmo.category_id).toBeNull()

    await automationsPage.goto()
    await expect(page.getByTestId('empty-state')).toContainText('Let Cashcove do the sorting')
    await automationsPage.addButton.click()
    // There has to be something to look for before going on.
    await expect(automationsPage.dialog.getByTestId('automation-next')).toBeDisabled()
    await automationsPage.findIn({ payees: ['Venmo'] })

    // Ticking said how many transactions it matches.
    await expect(automationsPage.dialog.getByTestId('automation-preview')).toContainText(
      'Matches 1 transaction you have now.',
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await automationsPage.next()

    // …and named it. The second step says what it does, in words.
    await expect(
      automationsPage.dialog.getByTestId('automation-name').getByRole('textbox'),
    ).toHaveValue('Venmo')
    await expect(automationsPage.dialog.getByTestId('automation-save')).toBeDisabled()
    await automationsPage.thenFill({ category: 'Gifts & donations' })
    await expect(automationsPage.dialog.getByTestId('automation-when')).toHaveText(
      'Payee is “Venmo”, in any account',
    )
    await expect(automationsPage.dialog.getByTestId('automation-then')).toContainText('put them in')
    await expectAccessible(page, { include: '.v-overlay--active' })
    await automationsPage.save()

    const card = automationsPage.card('Venmo')
    await expect(card).toContainText('1 matching transaction')
    await expect(card.getByTestId('automation-scope')).toHaveText('Past and future')
    await expect(card.getByTestId('category-chip')).toContainText('Gifts & donations')
    expect((await transaction(api, venmo.id)).category_id).toBe(gifts.id)

    // What arrives later is sorted too, whatever the letter case.
    const arrived = await api.post<Transaction>('/transactions', newPayment(baseline, 'venmo'))
    expect(arrived.category_id).toBe(gifts.id)
  })

  test('an automation for the future only leaves what is already there alone', async ({
    apiAs,
    baseline,
    automationsPage,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const restaurants = await category(api, 'Restaurants')
    const groceries = baseline.transactions.groceries
    expect(groceries.category).toBe('Groceries')
    await api.post('/transactions', newPayment(baseline, 'Hardware Hank', '-25.00'))

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.fillIn({
      payees: ['Whole Foods', 'Hardware Hank'],
      category: 'Restaurants',
      applyTo: 'future',
    })
    await automationsPage.save()

    const card = automationsPage.card('Whole Foods and 1 more')
    await expect(card.getByTestId('automation-scope')).toHaveText('Future only')
    await expect(card.getByTestId('automation-payees')).toContainText('Hardware Hank')
    // Nothing that was there changed.
    expect((await transaction(api, groceries.id)).category_id).toBe(
      baseline.categories.Groceries.id,
    )
    const [hank] = await transactionsFor(api, 'Hardware Hank')
    expect(hank!.category_id).toBeNull()

    // A transaction added by hand afterwards is sorted.
    await transactionsPage.goto()
    await transactionsPage.addButton.click()
    // A page object's own fill, not Playwright's page.fill.
    // eslint-disable-next-line playwright/prefer-locator
    await transactionsPage.fill({
      direction: 'out',
      amount: '18.00',
      payee: 'Whole Foods',
      account: 'Everyday checking',
    })
    await transactionsPage.save()
    const added = (await transactionsFor(api, 'Whole Foods')).find(
      (item) => item.id !== groceries.id,
    )
    expect(added?.category_id).toBe(restaurants.id)
    await expect(transactionsPage.row('Whole Foods').first()).toBeVisible()
  })

  test('an automation links payments to a subscription, past and future', async ({
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const power = baseline.transactions.power
    const paid = dateOf(power)
    // Due three days before the payment, so the payment settles it.
    const due = shift(paid, -3)
    const subscription = await api.post<Subscription>(
      '/subscriptions',
      newSubscription(baseline, 'City Power', '96.40', { next_due_date: due }),
    )
    expect(subscription.payment_count).toBe(0)

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.fillIn({ payees: ['City Power & Light'], subscription: 'City Power' })
    await automationsPage.save()

    await expect(
      automationsPage.card('City Power & Light').getByTestId('automation-subscription'),
    ).toHaveText('City Power')
    const linked = await transaction(api, power.id)
    expect(linked.subscription_id).toBe(subscription.id)
    // Its category stayed, since neither the automation nor the subscription gave one.
    expect(linked.category_id).toBe(baseline.categories.Utilities.id)
    const updated = await api.get<Subscription>(`/subscriptions/${subscription.id}`)
    expect(updated.payment_count).toBe(1)
    // The payment settled the due date, which moved a month on.
    expect(updated.next_due_date > paid).toBe(true)

    // Later payments are linked as they arrive.
    const arrived = await api.post<Transaction>(
      '/transactions',
      newPayment(baseline, 'City Power & Light', '-97.10'),
    )
    expect(arrived.subscription_id).toBe(subscription.id)
  })

  test('a bill that is a different amount every month still follows its subscription', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const subscription = await api.post<Subscription>(
      '/subscriptions',
      newSubscription(baseline, 'City Power', '100.00', { amount_varies: true }),
    )

    // The payee alone does it, whatever the amount, so there is nothing to fine-tune.
    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.fillIn({ payees: ['City Power & Light'], subscription: 'City Power' })
    await automationsPage.save()
    for (const amount of ['-104.20', '-88.00']) {
      const bill = await api.post<Transaction>(
        '/transactions',
        newPayment(baseline, 'City Power & Light', amount),
      )
      expect(bill.subscription_id).toBe(subscription.id)
    }

    // What to expect next is what the bills usually come to, not the amount it was set up with.
    const updated = await api.get<Subscription>(`/subscriptions/${subscription.id}`)
    expect(updated.payment_count).toBe(3)
    expect(updated.typical_amount).toBe('96.20')
    expect(updated.expected_amount).toBe('96.20')
    await page.goto('/subscriptions')
    const card = page.getByTestId('subscription-card').filter({ hasText: 'City Power' })
    await expect(card.getByTestId('subscription-amount')).toHaveText('~ $96.20')
    await expect(card.getByTestId('subscription-varies')).toHaveText('Amount varies')
    // Its payments are never a change of price.
    await expect(card.getByTestId('subscription-price-change')).toHaveCount(0)
  })

  test('one payee that bills several subscriptions is told apart by amount', async ({
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const basic = await api.post<Subscription>(
      '/subscriptions',
      newSubscription(baseline, 'Streamflix Basic', '2.99'),
    )
    const plus = await api.post<Subscription>(
      '/subscriptions',
      newSubscription(baseline, 'Streamflix Plus', '10.99'),
    )
    const small = await api.post<Transaction>(
      '/transactions',
      newPayment(baseline, 'STREAMFLIX*MEMBERSHIP', '-2.99'),
    )
    const large = await api.post<Transaction>(
      '/transactions',
      newPayment(baseline, 'STREAMFLIX*MEMBERSHIP', '-10.99'),
    )

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.findIn({
      texts: ['streamflix'],
      match: 'Contains',
      amount: { exactly: '2.99' },
    })
    await expect(automationsPage.dialog.getByTestId('automation-looks')).toHaveText(
      'Contains · any account · exactly $2.99',
    )
    await expect(automationsPage.dialog.getByTestId('automation-preview')).toContainText(
      'Matches 1 transaction you have now.',
    )
    await automationsPage.next()
    await expect(automationsPage.dialog.getByTestId('automation-when')).toHaveText(
      'Payee contains “streamflix”, in any account, for exactly $2.99',
    )
    await automationsPage.thenFill({ subscription: 'Streamflix Basic' })
    await automationsPage.save()

    await automationsPage.addButton.click()
    await automationsPage.fillIn({
      texts: ['streamflix'],
      match: 'Contains',
      amount: { from: '10', to: '11' },
      subscription: 'Streamflix Plus',
      name: 'Streamflix Plus',
    })
    await automationsPage.save()

    await expect(automationsPage.card('Streamflix Plus')).toContainText('$10.00 to $11.00')
    expect((await transaction(api, small.id)).subscription_id).toBe(basic.id)
    expect((await transaction(api, large.id)).subscription_id).toBe(plus.id)
    // Later payments go the same way, and one for another amount is left alone.
    const later = await api.post<Transaction>(
      '/transactions',
      newPayment(baseline, 'STREAMFLIX*MEMBERSHIP', '-2.99'),
    )
    expect(later.subscription_id).toBe(basic.id)
    const other = await api.post<Transaction>(
      '/transactions',
      newPayment(baseline, 'STREAMFLIX*MEMBERSHIP', '-5.00'),
    )
    expect(other.subscription_id).toBeNull()
  })

  test('the bank’s own wording is looked at too', async ({ apiAs, baseline, automationsPage }) => {
    const api = await apiAs('admin')
    const entertainment = await category(api, 'Entertainment')
    const netflix = baseline.transactions.netflix
    // The card's bank calls it Netflix, but its statements say NETFLIX.COM.
    expect(netflix.category).toBe('Subscriptions')

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.findIn({ texts: ['netflix.com'] })
    await expect(automationsPage.dialog.getByTestId('automation-preview')).toContainText(
      'Matches 1 transaction you have now.',
    )
    await automationsPage.next()
    await automationsPage.thenFill({ category: 'Entertainment' })
    await automationsPage.save()

    expect((await transaction(api, netflix.id)).category_id).toBe(entertainment.id)
  })

  test('an automation that overlaps another says so, and the older one wins', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const gifts = await category(api, 'Gifts & donations')
    const venmo = baseline.transactions.venmo
    await api.post('/automations', {
      name: 'Venmo payments',
      payees: ['Venmo'],
      category_id: gifts.id,
      apply_to: 'future',
    })

    await automationsPage.goto()
    await automationsPage.addButton.click()
    await automationsPage.findIn({ payees: ['Venmo'] })
    await automationsPage.next()
    await automationsPage.thenFill({ category: 'Entertainment' })

    // It says so, but it can be saved: the older automation just has the last word.
    await expect(automationsPage.dialog.getByTestId('automation-overlap')).toContainText(
      'Venmo payments already does this for 1 of them. The older automation wins where both apply.',
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await expect(automationsPage.dialog.getByTestId('automation-save')).toBeEnabled()
    await automationsPage.save()

    await expect(automationsPage.card('Venmo')).toBeVisible()
    expect((await transaction(api, venmo.id)).category_id).toBeNull()
    const arrived = await api.post<Transaction>('/transactions', newPayment(baseline, 'Venmo'))
    expect(arrived.category_id).toBe(gifts.id)
  })

  test('an admin pauses, resumes, changes and deletes an automation', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const gifts = await category(api, 'Gifts & donations')
    const venmo = baseline.transactions.venmo
    await api.post('/automations', {
      name: 'Venmo payments',
      payees: ['Venmo'],
      category_id: gifts.id,
      apply_to: 'future',
    })
    await automationsPage.goto()
    await expect(automationsPage.card('Venmo payments').getByTestId('automation-scope')).toHaveText(
      'Future only',
    )

    // Paused, it moves to the Paused list.
    await automationsPage.act('Venmo payments', 'toggle')
    await expect(automationsPage.cards).toHaveCount(0)
    await page.getByTestId('automation-filter').getByRole('button', { name: 'Paused' }).click()
    await expect(
      automationsPage.card('Venmo payments').getByTestId('automation-paused-chip'),
    ).toBeVisible()
    expect((await api.get<Automation[]>('/automations'))[0]!.active).toBe(false)
    await automationsPage.act('Venmo payments', 'toggle')
    await page.getByTestId('automation-filter').getByRole('button', { name: 'Active' }).click()
    await expect(automationsPage.card('Venmo payments')).toBeVisible()

    // Changed to cover the past, it sorts what's there.
    expect((await transaction(api, venmo.id)).category_id).toBeNull()
    await automationsPage.act('Venmo payments', 'edit')
    await expect(automationsPage.dialog.getByTestId('automation-chosen-payee')).toHaveText([
      'Venmo',
    ])
    await automationsPage.fillIn({ name: 'Venmo', applyTo: 'all' })
    await automationsPage.save()
    await expect(automationsPage.card('Venmo')).toContainText('Past and future')
    expect((await transaction(api, venmo.id)).category_id).toBe(gifts.id)

    // Changed again to look for text and an amount, it keeps what it did and does the rest.
    await automationsPage.act('Venmo', 'edit')
    await automationsPage.findIn({ match: 'Starts with', amount: { from: '30', to: '50' } })
    await automationsPage.next()
    await automationsPage.save()
    await expect(automationsPage.card('Venmo')).toContainText('$30.00 to $50.00')
    const [changed] = await api.get<Automation[]>('/automations')
    expect(changed).toMatchObject({
      match: 'starts_with',
      min_amount: '30.00',
      max_amount: '50.00',
    })

    // Deleted, what it sorted keeps its category and nothing new is sorted.
    await automationsPage.act('Venmo', 'delete')
    await page.getByTestId('confirm-accept').click()
    await expect(automationsPage.cards).toHaveCount(0)
    expect(await api.get<Automation[]>('/automations')).toEqual([])
    expect((await transaction(api, venmo.id)).category_id).toBe(gifts.id)
    const later = await api.post<Transaction>('/transactions', newPayment(baseline, 'Venmo'))
    expect(later.category_id).toBeNull()
  })

  test('transactions picked on the Transactions tab start an automation', async ({
    page,
    apiAs,
    baseline,
    automationsPage,
    transactionsPage,
  }) => {
    test.skip(test.info().project.name === 'mobile', 'Only computers select several at once')
    const api = await apiAs('admin')
    const entertainment = await category(api, 'Entertainment')
    const netflix = baseline.transactions.netflix

    await transactionsPage.goto({ q: 'Netflix' })
    await transactionsPage.select('Netflix')
    await transactionsPage.bulkBar.getByTestId('bulk-automate').click()

    // It's already looking for what was picked, and offers the amounts they were for.
    await expect(automationsPage.dialog.getByTestId('automation-chosen-payee')).toHaveText([
      'Netflix',
    ])
    await automationsPage.openFineTuning()
    await expect(automationsPage.dialog.getByTestId('automation-use-amounts')).toHaveText(
      'Use the amounts you ticked ($15.49)',
    )
    await automationsPage.dialog.getByTestId('automation-use-amounts').click()
    await expect(automationsPage.dialog.getByTestId('automation-looks')).toHaveText(
      'Exactly · any account · exactly $15.49',
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await automationsPage.next()
    await automationsPage.thenFill({ category: 'Entertainment' })
    await automationsPage.save()

    expect((await transaction(api, netflix.id)).category_id).toBe(entertainment.id)
    await expect(transactionsPage.bulkBar).toBeHidden()
  })

  test('what the bank sends is sorted as it arrives', async ({
    apiAs,
    baseline,
    connectPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    const entertainment = await category(api, 'Entertainment')
    await api.post('/automations', {
      name: 'Corner Cafe',
      payees: ['Corner Cafe'],
      category_id: entertainment.id,
      apply_to: 'future',
    })
    // Plaid calls it coffee, but the automation has the last word.
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
    const [synced] = await transactionsFor(api, 'Corner Cafe')
    expect(synced?.category_id).toBe(entertainment.id)
  })

  test('one automation sorts what the bank syncs and what a statement file brings in', async ({
    apiAs,
    baseline,
    connectPage,
    importPage,
    plaid,
  }) => {
    const api = await apiAs('admin')
    const entertainment = await category(api, 'Entertainment')
    // The bank syncs "Corner Cafe", where the statement file says "CORNER CAFE 0412 PORTLAND OR".
    await api.post('/automations', {
      name: 'Corner Cafe',
      payees: ['corner cafe'],
      match: 'contains',
      category_id: entertainment.id,
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
        { days_ago: 3, description: 'LA TAQUERIA', amount: '-23.80' },
      ]),
    )
    await importPage.continue()
    await importPage.chooseAccount('Everyday checking')
    await importPage.chooseBalance('keep')
    await importPage.importRows()
    await importPage.close()

    const found = await search(api, 'corner cafe')
    expect(found).toHaveLength(2)
    expect(found.map((item) => item.category_id)).toEqual([entertainment.id, entertainment.id])
    // What it doesn't look for is left as it came.
    const [other] = await search(api, 'taqueria')
    expect(other!.category_id).toBeNull()
  })
})

test.describe('Automations for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows the automations without ways to change them', async ({
    page,
    apiAs,
    automationsPage,
  }) => {
    const api = await apiAs('admin')
    const gifts = await category(api, 'Gifts & donations')
    await api.post('/automations', {
      name: 'Venmo payments',
      payees: ['Venmo'],
      category_id: gifts.id,
      apply_to: 'all',
    })

    await automationsPage.goto()

    await expect(page.getByTestId('read-only-notice')).toContainText(
      'Only an admin can change them',
    )
    await expect(automationsPage.card('Venmo payments')).toBeVisible()
    await expect(automationsPage.addButton).toHaveCount(0)
    await expect(page.getByTestId('automation-actions')).toHaveCount(0)
  })
})
