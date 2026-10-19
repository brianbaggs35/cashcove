import { randomUUID } from 'node:crypto'

import {
  dateInDays,
  expect,
  expectAccessible,
  householdDate,
  longDay,
  openOverlays,
  signInFiles,
  test,
  usd,
  type ApiClient,
  type BaselineData,
  type RecurringKind,
} from '../support'

interface Item {
  id: string
  name: string
  kind: RecurringKind
  amount: string
  amount_varies: boolean
  active: boolean
  payment_count: number
  next_due_date: string
  expected_amount: string | null
  last_payment_amount: string | null
}

interface Overview {
  subscription: Item
  summary: {
    total: string
    average: string | null
    highest: string | null
    lowest: string | null
    first_on: string | null
    this_year: string
  }
  history: { on: string; amount: string }[]
  upcoming: { due_on: string; amount: string }[]
  automations: { id: string; name: string; active: boolean }[]
  budgets: { id: string; name: string; period: string }[]
}

interface Transaction {
  id: string
  payee: string
  subscription_id: string | null
}

/** What the API takes to make a bill or a subscription, paid from checking unless said otherwise. */
function newItem(baseline: BaselineData, name: string, more: Record<string, unknown> = {}) {
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

/** A payment from checking, which is linked to whatever tracks its payee. */
function pay(
  api: ApiClient,
  baseline: BaselineData,
  payee: string,
  amount: string,
  daysAgo: number,
): Promise<Transaction> {
  return api.post<Transaction>('/transactions', {
    account_id: baseline.accounts.checking.id,
    date: householdDate(-daysAgo),
    amount: `-${amount}`,
    payee,
    category_id: null,
    notes: null,
  })
}

const BILLS = [
  '88.10',
  '91.75',
  '120.32',
  '143.88',
  '131.04',
  '99.60',
  '84.25',
  '79.90',
  '102.17',
  '118.45',
  '126.30',
]

/** What the bills here are paid to: nobody in the baseline is, so only what a test links is linked. */
const PAYEE = 'Lakeside Electric & Gas'
/** How a bank writes it on a statement, which no payee matches exactly. */
const STATEMENT = 'LAKESIDE ELECTRIC & GAS 0412 AUSTIN TX'

/** A bill with a year of payments that were different every month. */
async function billWithHistory(api: ApiClient, baseline: BaselineData, more = {}) {
  const bill = await api.post<Item>(
    '/bills',
    newItem(baseline, 'City Power', {
      amount_varies: true,
      payee: PAYEE,
      category_id: baseline.categories.Utilities.id,
      notes: 'Budget billing is off. Paid on the 3rd.',
      ...more,
    }),
  )
  for (const [index, amount] of BILLS.entries()) {
    await pay(api, baseline, PAYEE, amount, 20 + index * 30)
  }
  return bill
}

function overviewOf(api: ApiClient, item: Item): Promise<Overview> {
  const tab = item.kind === 'bill' ? 'bills' : 'subscriptions'
  return api.get<Overview>(`/${tab}/${item.id}/overview?today=${householdDate()}`)
}

test.describe('Bill and subscription pages', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('open from their lists by name, by the card and by the menu, and lead back', async ({
    page,
    shell,
    baseline,
    apiAs,
    billsPage,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const bill = await api.post<Item>('/bills', newItem(baseline, 'City Power'))
    const subscription = await api.post<Item>(
      '/subscriptions',
      newItem(baseline, 'Streamflix', { amount: '14.99' }),
    )

    // The name of a card is a link to the page.
    await billsPage.goto()
    await billsPage.card('City Power').getByTestId('bill-open').click()
    await expect(page).toHaveURL(new RegExp(`/bills/${bill.id}$`))
    await expect(recurringPage.title).toHaveText('City Power')
    await expect(page).toHaveTitle('City Power · Bill · Cashcove')
    // Its tab stays lit in the navigation, since it is a page within it.
    await shell.showMenu()
    await expect(shell.sideMenu.getByRole('link', { name: 'Bills' })).toHaveClass(
      /v-list-item--active/,
    )
    await shell.hideMenu()

    // The trail goes back to the list: on a phone, as one button.
    await recurringPage.back.click()
    await expect(page).toHaveURL(/\/bills$/)
    await expect(billsPage.cards).toHaveCount(1)

    // So does pressing anywhere on the card, which isn't a button of its own.
    await billsPage.card('City Power').click({ position: { x: 40, y: 40 } })
    await expect(page).toHaveURL(new RegExp(`/bills/${bill.id}$`))
    await recurringPage.back.click()

    // And so does View, which comes first in the menu, above pausing, cancelling, editing and deleting.
    await billsPage.card('City Power').getByTestId('bill-actions').click()
    const menu = openOverlays(page).locator('.v-list-item')
    await expect(menu).toHaveText(['View', 'Pause matching', 'Cancel bill', 'Edit', 'Delete'])
    await openOverlays(page).getByTestId('bill-view').click()
    await expect(page).toHaveURL(new RegExp(`/bills/${bill.id}$`))

    // Subscriptions are the same.
    await page.goto('/subscriptions')
    const card = page.getByTestId('subscription-card')
    await card.getByTestId('subscription-actions').click()
    await expect(openOverlays(page).locator('.v-list-item').first()).toHaveText('View')
    await openOverlays(page).getByTestId('subscription-view').click()
    await expect(page).toHaveURL(new RegExp(`/subscriptions/${subscription.id}$`))
    await expect(recurringPage.title).toHaveText('Streamflix')
    await expect(page).toHaveTitle('Streamflix · Subscription · Cashcove')
    await shell.showMenu()
    await expect(shell.sideMenu.getByRole('link', { name: 'Subscriptions' })).toHaveClass(
      /v-list-item--active/,
    )
    await shell.hideMenu()
    await recurringPage.back.click()
    await expect(page).toHaveURL(/\/subscriptions$/)
  })

  test('shows everything there is to know about a bill, as the API has it', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const bill = await billWithHistory(api, baseline)
    await api.post('/automations', {
      name: 'Electricity',
      payees: ['city power'],
      match: 'contains',
      subscription_id: bill.id,
      apply_to: 'future',
    })
    const budget = await api.post<{ id: string }>('/budgets', {
      name: 'Home',
      period: 'monthly',
      amount: '2000.00',
      starts_on: householdDate(-13),
      today: householdDate(),
    })
    await api.post(`/budgets/${budget.id}/sources`, {
      kind: 'spending',
      subscription_id: bill.id,
    })
    const overview = await overviewOf(api, bill)
    const { summary } = overview

    await recurringPage.goto('bill', bill.id)

    // Who it is, and how it is doing.
    await expect(recurringPage.title).toHaveText('City Power')
    await expect(page.getByTestId('show-status')).toHaveText('Active')
    await expect(page.getByTestId('show-frequency')).toHaveText('Monthly')
    await expect(page.getByTestId('show-paused-alert')).toHaveCount(0)
    await expect(page.getByTestId('show-overdue-alert')).toHaveCount(0)

    // What it costs: about what recent payments came to, since it changes every time.
    const expected = overview.subscription.expected_amount!
    expect(overview.subscription.payment_count).toBe(BILLS.length)
    expect(expected).not.toBe(overview.subscription.amount)
    await expect(recurringPage.stat('expected')).toContainText('~')
    await expect(recurringPage.stat('expected')).toContainText(usd(expected))
    await expect(recurringPage.stat('cost')).toContainText(usd(expected))
    await expect(recurringPage.stat('cost')).toContainText(`${usd(Number(expected) * 12)} a year`)
    await expect(recurringPage.stat('due')).toContainText('Due in 20 days')
    await expect(recurringPage.stat('paid')).toContainText(usd(summary.total))
    await expect(recurringPage.stat('paid')).toContainText(`${BILLS.length} payments since`)

    // What its payments came to.
    const figures = page.getByTestId('payment-figures')
    for (const value of [summary.this_year, summary.average!, summary.highest!, summary.lowest!]) {
      await expect(figures).toContainText(usd(value))
    }
    expect(overview.history).toHaveLength(BILLS.length)
    await expect(page.getByTestId('payment-chart')).toBeVisible()
    await page.getByTestId('chart-view-table').click()
    await expect(page.getByTestId('payment-row')).toHaveCount(BILLS.length)
    await page.getByTestId('chart-view-chart').click()

    // The payments themselves, the latest ten and then the rest on request.
    await expect(recurringPage.paymentRows).toHaveCount(10)
    await expect(recurringPage.payment(0)).toContainText(usd(BILLS[0]!))
    await recurringPage.payments.getByTestId('payments-more').click()
    await expect(recurringPage.paymentRows).toHaveCount(BILLS.length)
    await expect(recurringPage.payments.getByTestId('payments-more')).toHaveCount(0)
    await expect(recurringPage.payments.getByTestId('payments-view-all')).toHaveAttribute(
      'href',
      new RegExp(`/transactions\\?subscription=${bill.id}`),
    )

    // What is coming, counted on from the next payment, the first of them marked.
    const coming = recurringPage.upcoming.getByTestId('upcoming-payment')
    await expect(coming).toHaveCount(overview.upcoming.length)
    expect(overview.upcoming).toHaveLength(6)
    for (const [index, payment] of overview.upcoming.entries()) {
      await expect(coming.nth(index).getByTestId('upcoming-date')).toContainText(
        longDay(payment.due_on),
      )
    }
    await expect(coming.first()).toContainText('Next')
    await expect(coming.first().getByTestId('upcoming-amount')).toContainText('~')

    // What was set up.
    await expect(recurringPage.details.getByTestId('detail-kind')).toHaveText('Bill')
    await expect(recurringPage.details.getByTestId('detail-frequency')).toHaveText('Monthly')
    await expect(recurringPage.details.getByTestId('detail-account')).toContainText(
      'Everyday checking',
    )
    await expect(recurringPage.details.getByTestId('category-chip')).toContainText('Utilities')
    await expect(recurringPage.details.getByTestId('detail-payee')).toContainText(PAYEE)
    await expect(recurringPage.details.getByTestId('detail-reminder')).toContainText(
      '5 days before it is due',
    )
    await expect(recurringPage.details.getByTestId('detail-notes')).toHaveText(
      'Budget billing is off. Paid on the 3rd.',
    )

    // What refers to it, each a way to the place to change it.
    await expect(recurringPage.related.getByTestId('related-automations')).toContainText(
      'Electricity',
    )
    await recurringPage.related.getByRole('link', { name: /Home/ }).click()
    await expect(page).toHaveURL(new RegExp(`/budget\\?.*budget=${budget.id}`))
  })

  test('links payments to a bill from its page, and takes them off again after asking', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    test.slow()
    const api = await apiAs('admin')
    // Written the way a bank statement does, so nothing links them to the bill unless someone does.
    const odd = [
      await pay(api, baseline, STATEMENT, '101.20', 3),
      await pay(api, baseline, STATEMENT, '93.55', 12),
      await pay(api, baseline, STATEMENT, '88.40', 21),
    ]
    const bill = await api.post<Item>(
      '/bills',
      newItem(baseline, 'City Power', { amount_varies: true, payee: PAYEE }),
    )
    await pay(api, baseline, PAYEE, '96.40', 35)
    await pay(api, baseline, PAYEE, '90.10', 65)
    await recurringPage.goto('bill', bill.id)
    await expect(recurringPage.paymentRows).toHaveCount(2)

    // It opens already looking for payments like it, and leaves out what is linked here.
    const dialog = await recurringPage.openLinking('bill')
    await expect(dialog.getByTestId('payments-summary')).toContainText('2 payments linked.')
    await expect(dialog.getByTestId('payments-hint')).toContainText(PAYEE)
    await expect(dialog.getByTestId('finder-row')).toHaveCount(3)
    await expectAccessible(page, { include: '.v-overlay--active' })

    // Pressing a row ticks it, and the total says what the ticked ones come to.
    await recurringPage.choosePayment(dialog, odd[0]!.id)
    await recurringPage.choosePayment(dialog, odd[1]!.id)
    await expect(dialog.getByTestId('payments-picked')).toContainText(
      `2 payments chosen · ${usd(101.2 + 93.55)}`,
    )
    await expectAccessible(page, { include: '.v-overlay--active' })
    await dialog.getByTestId('payments-link-selected').click()

    await expect(page.getByText('Linked 2 payments to City Power')).toBeVisible()
    await expect(dialog.getByTestId('payments-summary')).toContainText('4 payments linked.')
    // What was linked is no longer left to find: only the third is.
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await expect(dialog.getByTestId('payments-picked')).toHaveCount(0)
    for (const payment of odd.slice(0, 2)) {
      expect((await api.get<Transaction>(`/transactions/${payment.id}`)).subscription_id).toBe(
        bill.id,
      )
    }
    expect((await api.get<Transaction>(`/transactions/${odd[2]!.id}`)).subscription_id).toBeNull()

    // The page followed it.
    await dialog.getByTestId('payments-done').click()
    await expect(dialog).toBeHidden()
    await expect(recurringPage.paymentRows).toHaveCount(4)
    await expect(recurringPage.payments).toContainText('4 payments')
    await expect(recurringPage.stat('paid')).toContainText('4 payments since')

    // Taking one off asks first, and nothing changes when the person thinks better of it.
    await recurringPage.actOnPayment(0, 'unlink')
    await expect(page.getByTestId('confirm-text')).toContainText('stays in your history')
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
    await expect(recurringPage.paymentRows).toHaveCount(4)
    expect((await api.get<Transaction>(`/transactions/${odd[0]!.id}`)).subscription_id).toBe(
      bill.id,
    )

    // And it comes off when they go ahead, the payment staying where it was.
    await recurringPage.actOnPayment(1, 'unlink')
    await page.getByTestId('confirm-accept').click()
    await expect(page.getByText(`Unlinked ${STATEMENT} from City Power`)).toBeVisible()
    await expect(recurringPage.paymentRows).toHaveCount(3)
    await expect(recurringPage.payments).toContainText('3 payments')
    const after = await api.get<Item>(`/bills/${bill.id}`)
    expect(after.payment_count).toBe(3)

    // A payment opens to all there is to know of it.
    await recurringPage.actOnPayment(0, 'details')
    const details = page.getByTestId('transaction-info-dialog')
    await expect(details).toBeVisible()
    await expect(details.getByTestId('transaction-info-amount')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(details).toBeHidden()
  })

  test('has nothing running off the side of the screen, on a phone or a computer', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const bill = await billWithHistory(api, baseline, { next_due_date: householdDate(-2) })
    await recurringPage.goto('bill', bill.id)
    await expect(recurringPage.paymentRows).toHaveCount(10)

    const overflow = () =>
      page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(await overflow()).toBeLessThanOrEqual(0)
    // Nor does the table of the chart, or the dialog that links payments.
    await page.getByTestId('chart-view-table').click()
    expect(await overflow()).toBeLessThanOrEqual(0)
    await page.getByTestId('chart-view-chart').click()
    await recurringPage.openLinking('bill')
    expect(await overflow()).toBeLessThanOrEqual(0)
    const dialog = recurringPage.linkDialog('bill')
    const box = await dialog.boundingBox()
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  })

  test('is changed, paused, resumed and deleted from its page, which says when it is late', async ({
    page,
    baseline,
    apiAs,
    billsPage,
    recurringPage,
  }) => {
    test.slow()
    const api = await apiAs('admin')
    const bill = await api.post<Item>(
      '/bills',
      newItem(baseline, 'City Power', { next_due_date: householdDate(-2) }),
    )
    await recurringPage.goto('bill', bill.id)

    // Two days late with nothing linked: it says so, with ways to put it right.
    await expect(page.getByTestId('show-overdue-alert')).toContainText(
      'Overdue by 2 days without a payment linked',
    )
    await expect(recurringPage.stat('due')).toContainText('Overdue by 2 days')
    await page.getByTestId('show-overdue-edit').click()
    await expect(billsPage.dialog).toBeVisible()
    await billsPage.fillIn({ name: 'Electric', dueDate: householdDate(25) })
    await billsPage.save()

    // The page follows what was saved, in its name, its trail and its tab's title, and is not late.
    await expect(recurringPage.title).toHaveText('Electric')
    await recurringPage.expectPlace('Electric', 'Bills')
    await expect(page).toHaveTitle('Electric · Bill · Cashcove')
    await expect(page.getByTestId('show-overdue-alert')).toHaveCount(0)
    expect((await api.get<Item>(`/bills/${bill.id}`)).name).toBe('Electric')

    // Paused, it says what that means and offers to resume; a late date isn't called late.
    await recurringPage.act('toggle')
    await expect(page.getByTestId('show-status')).toHaveText('Paused')
    await expect(page.getByTestId('show-paused-alert')).toContainText('Paused.')
    await expect(page.getByTestId('upcoming-paused')).toBeVisible()
    expect((await api.get<Item>(`/bills/${bill.id}`)).active).toBe(false)
    await page.getByTestId('show-resume').click()
    await expect(page.getByTestId('show-status')).toHaveText('Active')
    await expect(page.getByTestId('show-paused-alert')).toHaveCount(0)
    expect((await api.get<Item>(`/bills/${bill.id}`)).active).toBe(true)

    // Deleting asks first, and goes back to the list when it is done.
    await recurringPage.act('delete')
    await expect(page.getByTestId('confirm-text')).toContainText('will stay in your history')
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)
    await expect(recurringPage.title).toHaveText('Electric')
    await recurringPage.act('delete')
    await page.getByTestId('confirm-accept').click()
    await expect(page).toHaveURL(/\/bills$/)
    await expect(billsPage.cards).toHaveCount(0)
    expect(await api.get<Item[]>('/bills')).toEqual([])
  })

  test('warns of a payment due soon, and takes a price change on board', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    // Due in two days, which is within the three days subscriptions warn ahead by.
    const subscription = await api.post<Item>(
      '/subscriptions',
      newItem(baseline, 'Streamflix', {
        amount: '15.49',
        payee: 'Streamflix',
        next_due_date: householdDate(2),
      }),
    )
    await pay(api, baseline, 'Streamflix', '17.99', 28)
    await recurringPage.goto('subscription', subscription.id)

    await expect(page.getByTestId('show-due-alert')).toContainText(
      'Due in 2 days, within your 3-day reminder window.',
    )
    // A fixed amount isn't an estimate, and the last payment was not what it says.
    await expect(recurringPage.stat('expected')).not.toContainText('~')
    await expect(page.getByTestId('show-price-change')).toContainText(
      'The last payment was $17.99, not $15.49.',
    )
    await page.getByTestId('show-update-amount').click()

    await expect(page.getByText('Updated Streamflix to $17.99')).toBeVisible()
    await expect(page.getByTestId('show-price-change')).toHaveCount(0)
    await expect(recurringPage.stat('expected')).toContainText('$17.99')
    expect((await api.get<Item>(`/subscriptions/${subscription.id}`)).amount).toBe('17.99')
    await expectAccessible(page)
  })

  test('says an item is not there, whether it was deleted, is the other kind or was never one', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const subscription = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))

    // The ID of a subscription is no bill's, and an address that makes no sense isn't one at all.
    for (const address of [
      `/bills/${subscription.id}`,
      `/bills/${randomUUID()}`,
      '/bills/not-an-id',
    ]) {
      await page.goto(address)
      await expect(recurringPage.missing).toContainText('That bill doesn’t exist anymore')
      await recurringPage.expectPlace('Not found', 'Bills')
      await expect(recurringPage.title).toHaveCount(0)
    }
    await recurringPage.missing.getByRole('link', { name: 'Go to bills' }).click()
    await expect(page).toHaveURL(/\/bills$/)
    await page.goto(`/subscriptions/${randomUUID()}`)
    await expect(recurringPage.missing).toContainText('That subscription doesn’t exist anymore')
    await expectAccessible(page)
  })

  test('a subscription page shows a fixed amount and lets payments be linked from the empty list', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const netflix = baseline.transactions.netflix
    const subscription = await api.post<Item>(
      '/subscriptions',
      newItem(baseline, 'Streaming', {
        amount: '15.49',
        account_id: baseline.accounts.card.id,
        next_due_date: dateInDays(householdDate(), 9),
      }),
    )
    await recurringPage.goto('subscription', subscription.id)

    await expect(recurringPage.stat('expected')).toContainText('$15.49')
    await expect(recurringPage.stat('expected')).not.toContainText('~')
    await expect(recurringPage.stat('paid')).toContainText('0 payments')
    await expect(recurringPage.details.getByTestId('detail-kind')).toHaveText('Subscription')
    await expect(recurringPage.details.getByTestId('detail-reminder')).toContainText(
      '3 days before it is due',
    )
    await expect(recurringPage.upcoming.getByTestId('upcoming-payment')).toHaveCount(6)

    // Nothing is linked, so the list invites the first, and so does the card.
    await expect(page.getByTestId('empty-state')).toContainText('No payments yet')
    await page.getByTestId('payments-link-first').click()
    const dialog = recurringPage.linkDialog('subscription')
    await expect(dialog.getByTestId('payments-summary')).toContainText('0 payments linked.')
    // Nothing looks like its payee, so it says that, and offers to show them all.
    await expect(dialog.getByTestId('finder-empty')).toContainText('No payments found')
    await dialog.getByTestId('payments-clear').click()
    await dialog.getByTestId('finder-search').getByRole('searchbox').fill('Netflix')
    await expect(dialog.getByTestId('finder-row')).toHaveCount(1)
    await recurringPage.choosePayment(dialog, netflix.id)
    await dialog.getByTestId('payments-link-selected').click()
    await expect(dialog.getByTestId('payments-summary')).toContainText('1 payment linked.')
    await dialog.getByTestId('payments-done').click()

    await expect(recurringPage.paymentRows).toHaveCount(1)
    await expect(recurringPage.payment(0)).toContainText('Netflix')
    await expect(recurringPage.stat('paid')).toContainText('1 payment since')
  })
})

test.describe('Bill and subscription pages for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('show everything, without a way to change anything', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const admin = await apiAs('admin')
    const bill = await billWithHistory(admin, baseline, { next_due_date: householdDate(-2) })
    await recurringPage.goto('bill', bill.id)

    await expect(page.getByTestId('read-only-notice')).toContainText(
      'You can see this bill. Only an admin can change it.',
    )
    await expect(recurringPage.title).toHaveText('City Power')
    await expect(page.getByTestId('show-overdue-alert')).toBeVisible()
    await expect(recurringPage.paymentRows).toHaveCount(10)
    for (const hidden of [
      'show-edit',
      'show-link-payments',
      'show-actions',
      'payments-link',
      'payment-actions',
      'show-overdue-link',
      'show-overdue-edit',
    ]) {
      await expect(page.getByTestId(hidden), hidden).toHaveCount(0)
    }

    // They can still read each payment, and find their way back.
    await recurringPage.payment(0).getByTestId('payment-open').click()
    await expect(page.getByTestId('transaction-info-dialog')).toBeVisible()
    await expect(page.getByTestId('transaction-info-subscription-select')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('transaction-info-dialog')).toBeHidden()
    await expectAccessible(page)

    await recurringPage.back.click()
    await expect(page).toHaveURL(/\/bills$/)
    await page.getByTestId('bill-open').click()
    await expect(recurringPage.title).toHaveText('City Power')
  })
})
