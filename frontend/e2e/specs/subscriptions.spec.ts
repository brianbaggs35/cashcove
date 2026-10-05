import {
  choose,
  dateOf,
  expect,
  expectAccessible,
  openOverlays,
  signInFiles,
  test,
  type BaselineTransaction,
  type ApiClient,
} from '../support'

interface Subscription {
  id: string
  name: string
  amount: string
  amount_varies: boolean
  active: boolean
  payment_count: number
  last_payment_on: string | null
  next_due_date: string
}

interface TransactionPage {
  items: { id: string; subscription_id: string | null }[]
}

interface Transaction {
  id: string
  subscription_id: string | null
}

function dateInDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function dateInHouseholdDays(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts()
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)!.value)
  const date = new Date(Date.UTC(get('year'), get('month') - 1, get('day') + days))
  return date.toISOString().slice(0, 10)
}

async function linkedPayments(api: ApiClient, subscriptionId: string): Promise<TransactionPage> {
  return api.get<TransactionPage>(`/transactions?subscription_id=${subscriptionId}`)
}

test.describe('Subscriptions', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('creates from a past payment, edits, pauses, uses alert settings, and deletes', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const netflix: BaselineTransaction = baseline.transactions.netflix
    await page.goto('/subscriptions')
    const firstAdd = page.getByTestId('subscription-add-first')
    await firstAdd.click()

    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('subscription-name').getByRole('textbox').fill('Netflix Plus')
    await choose(dialog.getByTestId('subscription-account'), 'Rewards Visa')
    await choose(dialog.getByTestId('subscription-seed-transaction'), /Netflix/, {
      search: 'Netflix',
    })
    const dueDate = dateInHouseholdDays(4)
    const [year, month, day] = dueDate.split('-')
    await dialog
      .getByTestId('subscription-due-date')
      .getByRole('textbox')
      .fill(`${month}/${day}/${year}`)
    await dialog.getByTestId('subscription-due-date').getByRole('textbox').press('Tab')
    await dialog.getByTestId('subscription-save').click()
    await expect(dialog).toBeHidden()

    const card = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Plus' })
    await expect(card.getByTestId('subscription-title')).toHaveText('Netflix Plus')
    await expect(card.getByTestId('subscription-payment-count')).toContainText('1 payment tracked')
    await expect(page.getByTestId('subscriptions-due-alert')).toHaveCount(0)

    const created = await api.get<Subscription[]>('/subscriptions')
    expect(created).toHaveLength(1)
    const subscription = created[0]!
    expect(subscription.name).toBe('Netflix Plus')
    expect(subscription.payment_count).toBe(1)
    const payments = await linkedPayments(api, subscription.id)
    expect(payments.items.map((transaction) => transaction.id)).toContain(netflix.id)
    expect(
      payments.items.every((transaction) => transaction.subscription_id === subscription.id),
    ).toBe(true)

    await card.getByTestId('subscription-view-payments').click()
    await expect(page).toHaveURL(new RegExp(`/transactions\\?.*subscription=${subscription.id}`))
    await expect(transactionsPage.row('Netflix')).toBeVisible()

    await page.goto('/subscriptions')
    const currentCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Plus' })
    await currentCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-edit').click()
    const editDialog = page.getByRole('dialog')
    await editDialog.getByTestId('subscription-name').getByRole('textbox').fill('Netflix Family')
    await editDialog.getByTestId('subscription-save').click()
    await expect(editDialog).toBeHidden()
    await expect(page.getByTestId('subscription-title')).toHaveText('Netflix Family')

    const editedCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await editedCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-toggle').click()
    await page.getByTestId('subscription-filter').getByRole('button', { name: 'Paused' }).click()
    const pausedCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await expect(pausedCard.getByTestId('subscription-paused-chip')).toBeVisible()
    expect((await api.get<Subscription[]>('/subscriptions?active=false'))[0]?.active).toBe(false)

    await pausedCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-toggle').click()
    await page.getByTestId('subscription-filter').getByRole('button', { name: 'Active' }).click()
    await expect(page.getByTestId('subscriptions-due-alert')).toHaveCount(0)

    await page.goto('/settings/alerts')
    await expect(page).toHaveURL(/\/settings\/alerts$/)
    const alertRow = page.getByTestId('alert-subscription')
    await alertRow.getByRole('textbox', { name: "Days before it's due" }).fill('5')
    await page.getByTestId('save-bar').getByTestId('save').click()
    await expect(page.getByTestId('save-bar')).toHaveCount(0)
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-due-alert')).toContainText(
      '1 payment is due within your 5-day reminder window.',
    )
    await expect(page.getByTestId('subscription-due-alert')).toContainText(
      'Payment due within your 5-day reminder window.',
    )

    await page
      .getByTestId('subscriptions-due-alert')
      .getByRole('link', { name: 'Alert settings' })
      .click()
    await expect(page).toHaveURL(/\/settings\/alerts$/)
    await expect(
      page.getByTestId('alert-subscription').getByRole('textbox', { name: "Days before it's due" }),
    ).toHaveValue('5')
    await page.goBack()

    const finalCard = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Family' })
    await finalCard.getByTestId('subscription-actions').click()
    await openOverlays(page).getByTestId('subscription-delete').click()
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    expect(await api.get<Subscription[]>('/subscriptions')).toHaveLength(0)
    const retainedPayments = await api.get<TransactionPage>(
      `/transactions?account_id=${netflix.account_id}`,
    )
    expect(
      retainedPayments.items.find((transaction) => transaction.id === netflix.id)?.subscription_id,
    ).toBeNull()
  })

  test('a bill that changes every time is set up with an estimate', async ({ page, apiAs }) => {
    const api = await apiAs('admin')
    await page.goto('/subscriptions')
    await page.getByTestId('subscription-add-first').click()

    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('subscription-name').getByRole('textbox').fill('City Power')
    await dialog.getByTestId('subscription-amount').getByRole('textbox').fill('100')
    await expect(dialog.getByTestId('subscription-amount')).toContainText('Payment amount')
    await dialog.getByTestId('subscription-varies').getByRole('checkbox').check()
    await expect(dialog.getByTestId('subscription-amount')).toContainText('Estimated amount')
    await choose(dialog.getByTestId('subscription-account'), 'Everyday checking')
    const [year, month, day] = dateInHouseholdDays(10).split('-')
    const due = dialog.getByTestId('subscription-due-date').getByRole('textbox')
    await due.fill(`${month}/${day}/${year}`)
    await due.press('Tab')
    await expectAccessible(page, { include: '.v-overlay--active' })
    await dialog.getByTestId('subscription-save').click()
    await expect(dialog).toBeHidden()

    // Until there are payments to go by, what it says is the estimate.
    const card = page.getByTestId('subscription-card').filter({ hasText: 'City Power' })
    await expect(card.getByTestId('subscription-amount')).toHaveText('~ $100.00')
    await expect(card.getByTestId('subscription-varies')).toHaveText('Amount varies')
    expect((await api.get<Subscription[]>('/subscriptions'))[0]).toMatchObject({
      amount: '100.00',
      amount_varies: true,
    })
  })

  test('a payment that was not what it should have been offers the new amount', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const netflix = baseline.transactions.netflix
    // The price went up, since it says 13.99 and the last payment was 15.49.
    const subscription = await api.post<Subscription>('/subscriptions', {
      name: 'Netflix Plus',
      amount: '13.99',
      amount_varies: false,
      frequency: 'monthly',
      account_id: baseline.accounts.card.id,
      next_due_date: dateInHouseholdDays(20),
      category_id: null,
      notes: null,
      payee: 'Netflix',
      seed_transaction_id: netflix.id,
    })

    await page.goto('/subscriptions')
    const card = page.getByTestId('subscription-card').filter({ hasText: 'Netflix Plus' })
    await expect(card.getByTestId('subscription-price-change')).toContainText(
      'The last payment was $15.49, not $13.99.',
    )
    await expectAccessible(page)
    await card.getByTestId('subscription-update-amount').click()

    await expect(card.getByTestId('subscription-price-change')).toHaveCount(0)
    await expect(card.getByTestId('subscription-amount')).toHaveText('$15.49')
    expect((await api.get<Subscription>(`/subscriptions/${subscription.id}`)).amount).toBe('15.49')
  })

  test('a payment is linked to a subscription by hand from its details, and taken off again', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const venmo = baseline.transactions.venmo
    const subscription = await api.post<Subscription>('/subscriptions', {
      name: 'Rent share',
      amount: '40.00',
      frequency: 'monthly',
      account_id: baseline.accounts.checking.id,
      next_due_date: dateInDays(dateOf(venmo), -2),
      category_id: null,
      notes: null,
      payee: 'Nobody in particular',
      seed_transaction_id: null,
    })

    await transactionsPage.goto({ q: 'Venmo' })
    await transactionsPage.openDetails('Venmo')
    const field = transactionsPage.infoDialog.getByTestId('transaction-info-subscription-select')
    await expectAccessible(page, { include: '.v-overlay--active' })
    await choose(field, 'Rent share')

    await expect(page.getByText('Linked it to Rent share')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBe(
      subscription.id,
    )
    const linked = await api.get<Subscription>(`/subscriptions/${subscription.id}`)
    expect(linked.payment_count).toBe(1)
    expect(linked.next_due_date > dateOf(venmo)).toBe(true)

    // Taken off again, it's just a transaction.
    await field.getByRole('button', { name: 'Clear Subscription' }).click()
    await expect(page.getByText('Took it off the subscription')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBeNull()
    expect((await api.get<Subscription>(`/subscriptions/${subscription.id}`)).payment_count).toBe(0)
  })

  test('selected payments are linked to a subscription together', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    // The list only offers ticking several transactions on a computer, so phones skip this one.
    test.skip(test.info().project.name === 'mobile', 'Only computers select several at once')
    const api = await apiAs('admin')
    const { venmo, groceries, paycheck } = baseline.transactions
    const subscription = await api.post<Subscription>('/subscriptions', {
      name: 'Shared costs',
      amount: '60.00',
      frequency: 'monthly',
      account_id: baseline.accounts.checking.id,
      next_due_date: dateInDays(dateOf(venmo), -2),
      category_id: null,
      notes: null,
      payee: 'Nobody in particular',
      seed_transaction_id: null,
    })

    await transactionsPage.goto()
    // The paycheck is money coming in, which isn't a payment.
    await transactionsPage.select('Venmo', 'Whole Foods', 'Acme Corp')
    await expect(transactionsPage.bulkBar).toContainText('3 selected')
    await transactionsPage.bulkBar.getByTestId('bulk-link').click()
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('link-apply') })
    await expect(dialog.getByTestId('link-skipped')).toContainText(
      '1 selected transaction is money coming in',
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await choose(dialog.getByTestId('link-subscription'), 'Shared costs')
    await dialog.getByTestId('link-apply').click()
    await expect(dialog).toBeHidden()

    await expect(page.getByText('Linked 2 payments to Shared costs')).toBeVisible()
    for (const linked of [venmo, groceries]) {
      expect((await api.get<Transaction>(`/transactions/${linked.id}`)).subscription_id).toBe(
        subscription.id,
      )
    }
    expect((await api.get<Transaction>(`/transactions/${paycheck.id}`)).subscription_id).toBeNull()
    expect((await api.get<Subscription>(`/subscriptions/${subscription.id}`)).payment_count).toBe(2)
    await expect(transactionsPage.bulkBar).toBeHidden()
  })

  test('links payments from any account to a subscription and settles its due date', async ({
    page,
    baseline,
    apiAs,
    transactionsPage,
  }) => {
    const api = await apiAs('admin')
    const venmo = baseline.transactions.venmo
    const paid = dateOf(venmo)
    // Due two days before the payment, which is from checking rather than the card it's tracked on.
    const due = dateInDays(paid, -2)
    const subscription = await api.post<Subscription>('/subscriptions', {
      name: 'Rent share',
      amount: '40.00',
      frequency: 'monthly',
      account_id: baseline.accounts.card.id,
      next_due_date: due,
      category_id: null,
      notes: null,
      payee: 'Nobody in particular',
      seed_transaction_id: null,
    })
    await page.goto('/subscriptions')
    const card = page.getByTestId('subscription-card').filter({ hasText: 'Rent share' })
    await expect(card.getByTestId('subscription-payment-count')).toContainText('0 payments tracked')
    await expect(card.getByTestId('subscription-due')).toContainText('Overdue')

    await card.getByTestId('subscription-link-payments').click()
    const dialog = page.getByTestId('subscription-payments-dialog')
    await expect(dialog.getByTestId('payments-summary')).toContainText('0 payments linked.')
    await dialog.getByTestId('finder-search').getByRole('searchbox').fill('Venmo')
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await expectAccessible(page, { include: '.v-overlay--active' })
    await dialog.getByTestId(`payment-link-${venmo.id}`).click()
    await expect(dialog.getByTestId('payments-summary')).toContainText('1 payment linked.')
    await expect(dialog.getByTestId(`payment-unlink-${venmo.id}`)).toBeVisible()

    const linked = await api.get<Subscription>(`/subscriptions/${subscription.id}`)
    expect(linked.payment_count).toBe(1)
    expect(linked.last_payment_on).toBe(paid)
    // The payment settled the due date, which moved a month on.
    expect(linked.next_due_date > paid).toBe(true)
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBe(
      subscription.id,
    )

    await dialog.getByTestId('payments-done').click()
    await expect(dialog).toBeHidden()
    await expect(card.getByTestId('subscription-payment-count')).toContainText('1 payment tracked')
    await expect(card.getByTestId('subscription-last-payment')).toBeVisible()
    await expect(card.getByTestId('subscription-due')).not.toContainText('Overdue')

    // The transaction says which subscription it's a payment of.
    await transactionsPage.goto({ q: 'Venmo' })
    await transactionsPage.openDetails('Venmo')
    await expect(
      transactionsPage.infoDialog.getByTestId('transaction-info-subscription-select'),
    ).toContainText('Rent share')
    await page.keyboard.press('Escape')

    // Taken off again, it's just a transaction.
    await page.goto('/subscriptions')
    await card.getByTestId('subscription-link-payments').click()
    await dialog.getByTestId('payments-scope').getByRole('button', { name: 'Linked here' }).click()
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await dialog.getByTestId(`payment-unlink-${venmo.id}`).click()
    await expect(dialog.getByTestId('payments-summary')).toContainText('0 payments linked.')
    await expect(dialog.getByTestId('finder-empty')).toBeVisible()
    expect((await api.get<Transaction>(`/transactions/${venmo.id}`)).subscription_id).toBeNull()
  })
})
