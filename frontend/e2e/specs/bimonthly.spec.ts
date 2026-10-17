import type { Page } from '@playwright/test'

import {
  choose,
  expect,
  expectAccessible,
  householdDate,
  longDay,
  openOverlays,
  signInFiles,
  test,
  type ApiClient,
  type BaselineData,
} from '../support'

interface Item {
  id: string
  name: string
  kind: 'bill' | 'subscription'
  frequency: string
  amount: string
  next_due_date: string
  payment_count: number
}

/** The same day of the month `months` later, or the last day of that month when it is shorter. */
function monthsAfter(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const last = new Date(Date.UTC(year, month + months, 0)).getUTCDate()
  return new Date(Date.UTC(year, month - 1 + months, Math.min(date, last)))
    .toISOString()
    .slice(0, 10)
}

/** What the API takes to make a bill, paid from checking, every two months unless said otherwise. */
function newBill(baseline: BaselineData, name: string, more: Record<string, unknown> = {}) {
  return {
    name,
    amount: '102.18',
    amount_varies: false,
    frequency: 'bimonthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: householdDate(20),
    category_id: null,
    notes: null,
    payee: name,
    seed_transaction_id: null,
    ...more,
  }
}

/** A payment from checking, which is linked to whatever tracks its payee. */
function pay(api: ApiClient, baseline: BaselineData, payee: string, daysAgo = 0) {
  return api.post('/transactions', {
    account_id: baseline.accounts.checking.id,
    date: householdDate(-daysAgo),
    amount: '-102.18',
    payee,
    category_id: null,
    notes: null,
  })
}

/**
 * Opens a subscription's dialog from its card's menu, checks it starts from how often it is paid
 * now, chooses another and saves.
 */
async function payEvery(page: Page, name: string, from: string, to: string): Promise<void> {
  const card = page.getByTestId('subscription-card').filter({ hasText: name })
  await card.getByTestId('subscription-actions').click()
  await openOverlays(page).getByTestId('subscription-edit').click()
  const dialog = page.getByRole('dialog')
  const frequency = dialog.getByTestId('subscription-frequency')
  await expect(frequency).toContainText(from)
  await choose(frequency, to)
  await dialog.getByTestId('subscription-save').click()
  await expect(dialog).toBeHidden()
}

/** How often a payment can be made, in the order the dialog lists them. */
const FREQUENCIES = [
  'Weekly',
  'Every two weeks',
  'Monthly',
  'Every two months',
  'Every three months',
  'Every six months',
  'Annually',
]

test.describe('Bi-monthly billing', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('every frequency can be chosen from the list without scrolling to the last', async ({
    page,
    billsPage,
  }) => {
    await billsPage.goto()
    await billsPage.addButton.click()
    await billsPage.dialog.getByTestId('bill-frequency').locator('.v-field').click()

    // Weekly to annually, none cut off at the bottom of the list, which Vuetify's select menu
    // does from seven rows on unless it is told to be taller.
    for (const title of FREQUENCIES) {
      await expect(
        openOverlays(page).getByRole('option', { name: title, exact: true }),
      ).toBeInViewport({ ratio: 1 })
    }
  })

  test('a bill paid every two months is added from its dialog, and its card, page and coming payments say so', async ({
    page,
    apiAs,
    billsPage,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(20)
    await billsPage.goto()
    await billsPage.addButton.click()

    await billsPage.fillIn({
      name: 'Town Water',
      account: 'Everyday checking',
      amount: '102.18',
      frequency: 'Every two months',
      dueDate: due,
    })
    await expect(billsPage.dialog.getByTestId('bill-frequency')).toContainText('Every two months')
    await billsPage.save()

    const [bill] = await api.get<Item[]>('/bills')
    expect(bill).toMatchObject({
      name: 'Town Water',
      kind: 'bill',
      frequency: 'bimonthly',
      amount: '102.18',
      next_due_date: due,
    })

    // One payment every two months costs half as much a month, and six payments make a year.
    const card = billsPage.card('Town Water')
    await expect(card).toContainText('Every two months')
    await expect(card).toContainText('$51.09 / month')
    await expect(page.getByTestId('bills-monthly')).toContainText('$51.09')
    await expect(page.getByTestId('bills-yearly')).toContainText('$613.08')

    await recurringPage.goto('bill', bill!.id)
    await expect(page.getByTestId('show-frequency')).toHaveText('Every two months')
    await expect(recurringPage.stat('expected')).toContainText('Every two months')
    await expect(recurringPage.stat('cost')).toContainText('$51.09')
    await expect(recurringPage.stat('cost')).toContainText('$613.08 a year')
    await expect(recurringPage.details.getByTestId('detail-frequency')).toHaveText(
      'Every two months',
    )

    // What is coming is two months apart, counted on from the first each time rather than from
    // the one before, so a short month doesn't move the day for good.
    const coming = recurringPage.upcoming.getByTestId('upcoming-payment')
    await expect(coming).toHaveCount(6)
    for (const index of [0, 1, 2, 3, 4, 5]) {
      await expect(coming.nth(index).getByTestId('upcoming-date')).toContainText(
        longDay(monthsAfter(due, 2 * index)),
      )
    }
    await expect(coming.first()).toContainText('Next')
    await expect(coming.first().getByTestId('upcoming-amount')).toContainText('$102.18')
    await expectAccessible(page)
  })

  test('a payment settles a bill’s due date two months on, and one made too early for it changes nothing', async ({
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(20)
    const bill = await api.post<Item>('/bills', newBill(baseline, 'Town Water'))
    expect(bill).toMatchObject({ frequency: 'bimonthly', next_due_date: due })

    // Not a frequency, whatever it is meant to be: twice a month, or every two months written out.
    for (const frequency of ['bi-monthly', 'semimonthly', 'every two months']) {
      await expect(
        api.post('/bills', newBill(baseline, 'Other water', { frequency })),
      ).rejects.toThrow(/failed with 422/)
    }

    // A payment from 45 days ago is the last one's, long before this one is due.
    await pay(api, baseline, 'Town Water', 45)
    const old = await api.get<Item>(`/bills/${bill.id}`)
    expect(old).toMatchObject({ payment_count: 1, next_due_date: due })

    // One made today is for the one due in 20 days, so the next is two months after that.
    await pay(api, baseline, 'Town Water')
    const settled = await api.get<Item>(`/bills/${bill.id}`)
    expect(settled).toMatchObject({ payment_count: 2, next_due_date: monthsAfter(due, 2) })

    // And a second the same day isn't for the one two months away.
    await pay(api, baseline, 'Town Water')
    const again = await api.get<Item>(`/bills/${bill.id}`)
    expect(again).toMatchObject({ payment_count: 3, next_due_date: monthsAfter(due, 2) })

    await recurringPage.goto('bill', bill.id)
    await expect(recurringPage.stat('paid')).toContainText('3 payments since')
    await expect(
      recurringPage.upcoming.getByTestId('upcoming-payment').first().getByTestId('upcoming-date'),
    ).toContainText(longDay(monthsAfter(due, 2)))
    await expect(recurringPage.stat('due')).not.toContainText('Overdue')
  })

  test('a subscription is paid every two months from its dialog, and is changed to and from it', async ({
    page,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    await page.goto('/subscriptions')
    await page.getByTestId('subscription-add-first').click()

    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('subscription-name').getByRole('textbox').fill('Cloud Storage')
    await choose(dialog.getByTestId('subscription-account'), 'Everyday checking')
    await dialog.getByTestId('subscription-amount').getByRole('textbox').fill('30.00')
    await choose(dialog.getByTestId('subscription-frequency'), 'Every two months')
    const [year, month, day] = householdDate(12).split('-')
    const dueDate = dialog.getByTestId('subscription-due-date').getByRole('textbox')
    await dueDate.fill(`${month}/${day}/${year}`)
    // Tab rather than Enter, which would save the dialog.
    await dueDate.press('Tab')
    await dialog.getByTestId('subscription-save').click()
    await expect(dialog).toBeHidden()

    const card = page.getByTestId('subscription-card').filter({ hasText: 'Cloud Storage' })
    await expect(card).toContainText('Every two months')
    await expect(card).toContainText('$15.00 / month')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('$15.00')
    await expect(page.getByTestId('subscriptions-yearly')).toContainText('$180.00')
    const [created] = await api.get<Item[]>('/subscriptions')
    expect(created).toMatchObject({ kind: 'subscription', frequency: 'bimonthly', amount: '30.00' })

    // Monthly, one payment is what it costs a month, and twelve make a year.
    await payEvery(page, 'Cloud Storage', 'Every two months', 'Monthly')
    await expect(card).toContainText('$30.00 / month')
    await expect(page.getByTestId('subscriptions-yearly')).toContainText('$360.00')
    expect((await api.get<Item>(`/subscriptions/${created!.id}`)).frequency).toBe('monthly')

    await payEvery(page, 'Cloud Storage', 'Monthly', 'Every two months')
    await expect(card).toContainText('$15.00 / month')
    await expect(page.getByTestId('subscriptions-yearly')).toContainText('$180.00')
    expect((await api.get<Item>(`/subscriptions/${created!.id}`)).frequency).toBe('bimonthly')
    await expectAccessible(page)
  })
})
