import type { Page } from '@playwright/test'

import {
  expect,
  expectAccessible,
  householdDate,
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
  active: boolean
  next_due_date: string
  ends_on: string | null
  cancelled_on: string | null
  payment_count: number
}

/** A day as the app writes it in a card or a sentence, e.g. "Nov 5, 2026". */
function mediumDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(
    new Date(year, month - 1, date),
  )
}

/** A day as it is typed into a date field in the baseline household's format. */
function typed(day: string): string {
  const [year, month, date] = day.split('-')
  return `${month}/${date}/${year}`
}

/** What the API takes to make a subscription, paid from checking. */
function newItem(baseline: BaselineData, name: string, more: Record<string, unknown> = {}) {
  return {
    name,
    amount: '14.99',
    amount_varies: false,
    frequency: 'monthly',
    account_id: baseline.accounts.checking.id,
    next_due_date: householdDate(9),
    category_id: null,
    notes: null,
    payee: name,
    seed_transaction_id: null,
    ...more,
  }
}

/** A payment from checking, which is linked to whatever tracks its payee. */
function pay(api: ApiClient, baseline: BaselineData, payee: string, daysAgo: number) {
  return api.post('/transactions', {
    account_id: baseline.accounts.checking.id,
    date: householdDate(-daysAgo),
    amount: '-14.99',
    payee,
    category_id: null,
    notes: null,
  })
}

const card = (page: Page, name: string) =>
  page.getByTestId('subscription-card').filter({ hasText: name })

/** Chooses an item of a subscription card's menu. */
async function act(page: Page, name: string, action: 'cancel' | 'reactivate' | 'edit' | 'delete') {
  await card(page, name).getByTestId('subscription-actions').click()
  await openOverlays(page).getByTestId(`subscription-${action}`).click()
}

const filter = (page: Page, name: 'Active' | 'Paused' | 'Cancelled') =>
  page.getByTestId('subscription-filter').getByRole('button', { name })

test.describe('Cancelling and reactivating subscriptions and bills', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a subscription is cancelled from its card, and it and its payments are kept', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(9)
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await pay(api, baseline, 'Streamflix', 40)
    await pay(api, baseline, 'Streamflix', 10)
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-count')).toContainText('1')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('$14.99')

    await act(page, 'Streamflix', 'cancel')

    // It starts from the day it would next be paid, which is when a service usually stops, and
    // says what it stops costing then.
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Cancel Streamflix?')
    const ends = dialog.getByTestId('subscription-cancel-day').getByRole('textbox')
    await expect(ends).toHaveValue(typed(due))
    await expect(dialog.getByTestId('subscription-cancel-suggested')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.getByTestId('subscription-cancel-saving')).toHaveText(
      'Once it ends, you stop paying about $14.99 a month, $179.88 a year.',
    )
    await dialog.getByTestId('subscription-cancel-confirm').click()
    await expect(dialog).toBeHidden()

    // It has left what is paid, in the count and the totals and the list of those being tracked,
    // and the empty list says what the filter is for instead of that nothing matches.
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-none-match')).toContainText(
      'No active subscriptions',
    )
    await expect(page.getByTestId('subscriptions-count')).toContainText('0')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('—')
    await expect(page.getByTestId('subscriptions-yearly')).toContainText('—')

    // But it is not gone: it is under Cancelled, still counting its payments, and says when it ends.
    await filter(page, 'Cancelled').click()
    const cancelled = card(page, 'Streamflix')
    await expect(cancelled.getByTestId('subscription-end-chip')).toHaveText('Cancelled')
    await expect(cancelled.getByTestId('subscription-due')).toHaveText(`Ends ${mediumDay(due)}`)
    await expect(cancelled.getByTestId('subscription-payment-count')).toContainText(
      '2 payments tracked',
    )
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      cancelled_on: householdDate(),
      ends_on: due,
      payment_count: 2,
      active: true,
    })

    // The place in its menu that said Cancel now says Reactivate, never both, and it isn't paused.
    await cancelled.getByTestId('subscription-actions').click()
    const menu = openOverlays(page)
    await expect(menu.getByTestId('subscription-reactivate')).toHaveText('Reactivate subscription')
    await expect(menu.getByTestId('subscription-cancel')).toHaveCount(0)
    await expect(menu.getByTestId('subscription-toggle')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('its page says how it ended and keeps its payments, and it is reactivated from there', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(9)
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await pay(api, baseline, 'Streamflix', 40)
    await pay(api, baseline, 'Streamflix', 10)
    await recurringPage.goto('subscription', made.id)
    await expect(page.getByTestId('show-status')).toHaveText('Active')
    await expect(recurringPage.upcoming.getByTestId('upcoming-payment').first()).toBeVisible()

    await recurringPage.act('cancel')
    await page.getByRole('dialog').getByTestId('subscription-cancel-confirm').click()
    await expect(page.getByRole('dialog')).toBeHidden()

    await expect(page.getByTestId('show-status')).toHaveText('Cancelled')
    await expect(page.getByTestId('show-ends')).toHaveText(`Ends ${mediumDay(due)}`)
    await expect(page.getByTestId('show-end-alert')).toContainText(
      `Cancelled on ${mediumDay(householdDate())}. It ends on ${mediumDay(due)}`,
    )
    // Nothing is due, so it says when it ends where it says when it is due, and lists no payments.
    await expect(recurringPage.stat('due')).toContainText('Ends')
    await expect(recurringPage.stat('due')).toContainText(`Cancelled ${mediumDay(householdDate())}`)
    await expect(recurringPage.upcoming.getByTestId('upcoming-payment')).toHaveCount(0)
    await expect(recurringPage.upcoming.getByTestId('upcoming-ends')).toContainText(
      `Nothing more is due: it ends on ${mediumDay(due)}.`,
    )
    await expect(recurringPage.details.getByTestId('detail-cancelled')).toHaveText(
      mediumDay(householdDate()),
    )
    // Its history is all still there.
    await expect(recurringPage.paymentRows).toHaveCount(2)
    await expect(recurringPage.stat('paid')).toContainText('$29.98')
    await expectAccessible(page)

    // It is reactivated from what says it ended, in a dialog that starts from its next payment.
    await page.getByTestId('show-reactivate').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Reactivate Streamflix?')
    const next = dialog.getByTestId('subscription-reactivate-day').getByRole('textbox')
    await expect(next).toHaveValue(typed(due))
    await expect(dialog.getByTestId('subscription-reactivate-cost')).toHaveText(
      'It counts toward what you pay again: about $14.99 a month, $179.88 a year.',
    )
    // Another day can be chosen, and the old schedule chosen again.
    await dialog.getByTestId('subscription-reactivate-today').click()
    await expect(next).toHaveValue(typed(householdDate()))
    await dialog.getByTestId('subscription-reactivate-suggested').click()
    await expect(next).toHaveValue(typed(due))
    await dialog.getByTestId('subscription-reactivate-confirm').click()
    await expect(dialog).toBeHidden()

    // It is a regular one again: tracked, nothing ended, and the payments to come are listed.
    await expect(page.getByTestId('show-status')).toHaveText('Active')
    await expect(page.getByTestId('show-end-alert')).toHaveCount(0)
    await expect(page.getByTestId('show-ends')).toHaveCount(0)
    await expect(recurringPage.upcoming.getByTestId('upcoming-payment').first()).toBeVisible()
    await expect(recurringPage.paymentRows).toHaveCount(2)
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      active: true,
      cancelled_on: null,
      ends_on: null,
      next_due_date: due,
      payment_count: 2,
    })
  })

  test('cancelling as of today ends it at once, and it is reactivated from its card', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(9)
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await page.goto('/subscriptions')

    await act(page, 'Streamflix', 'cancel')
    const dialog = page.getByRole('dialog')
    await dialog.getByTestId('subscription-cancel-today').click()
    await expect(dialog.getByTestId('subscription-cancel-day').getByRole('textbox')).toHaveValue(
      typed(householdDate()),
    )
    await dialog.getByTestId('subscription-cancel-confirm').click()
    await expect(dialog).toBeHidden()

    await filter(page, 'Cancelled').click()
    await expect(card(page, 'Streamflix').getByTestId('subscription-due')).toHaveText(
      `Ended ${mediumDay(householdDate())}`,
    )
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      cancelled_on: householdDate(),
      ends_on: householdDate(),
    })

    // Its next payment hasn't gone by, so that is where it carries on from.
    await act(page, 'Streamflix', 'reactivate')
    const reactivate = page.getByRole('dialog')
    await expect(
      reactivate.getByTestId('subscription-reactivate-day').getByRole('textbox'),
    ).toHaveValue(typed(due))
    await reactivate.getByTestId('subscription-reactivate-confirm').click()
    await expect(reactivate).toBeHidden()

    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-none-match')).toContainText(
      'No cancelled subscriptions',
    )
    await filter(page, 'Active').click()
    await expect(card(page, 'Streamflix')).toBeVisible()
    await expect(card(page, 'Streamflix').getByTestId('subscription-end-chip')).toHaveCount(0)
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      active: true,
      cancelled_on: null,
      ends_on: null,
      next_due_date: due,
    })
  })

  test('one cancelled long ago is picked up on its old schedule, not already late, and works like a regular one', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    // Weekly, last due ten days ago and cancelled then: three days ago was a cycle on, so the next
    // by its schedule is four days from now. It was paused too, which reactivating undoes.
    const made = await api.post<Item>(
      '/subscriptions',
      newItem(baseline, 'Gym', { frequency: 'weekly', next_due_date: householdDate(-10) }),
    )
    await api.patch(`/subscriptions/${made.id}`, { active: false })
    await api.post(`/subscriptions/${made.id}/cancellation`, {
      cancelled_on: householdDate(-10),
      ends_on: householdDate(-10),
    })
    await page.goto('/subscriptions')
    await filter(page, 'Cancelled').click()
    await expect(card(page, 'Gym').getByTestId('subscription-due')).toHaveText(
      `Ended ${mediumDay(householdDate(-10))}`,
    )

    await act(page, 'Gym', 'reactivate')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Reactivate Gym?')
    await expect(
      dialog.getByTestId('subscription-reactivate-day').getByRole('textbox'),
    ).toHaveValue(typed(householdDate(4)))
    await expect(dialog.getByTestId('subscription-reactivate-suggested')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(dialog.getByTestId('subscription-reactivate-cost')).toContainText(
      'about $64.96 a month, $779.48 a year',
    )
    await dialog.getByTestId('subscription-reactivate-confirm').click()
    await expect(dialog).toBeHidden()

    // It is back in what is tracked and paid, due in four days and not late.
    await filter(page, 'Active').click()
    const gym = card(page, 'Gym')
    await expect(gym.getByTestId('subscription-end-chip')).toHaveCount(0)
    await expect(gym.getByTestId('subscription-paused-chip')).toHaveCount(0)
    await expect(gym.getByTestId('subscription-due')).toContainText('Due')
    await expect(gym.getByTestId('subscription-due')).not.toContainText('Overdue')
    await expect(page.getByTestId('subscriptions-overdue-alert')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-count')).toContainText('1')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('$64.96')
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      active: true,
      cancelled_on: null,
      ends_on: null,
      next_due_date: householdDate(4),
    })

    // A payment that comes now is its payment like any other's, and it is on the dashboard again.
    await pay(api, baseline, 'Gym', 0)
    expect((await api.get<Item>(`/subscriptions/${made.id}`)).payment_count).toBe(1)
    await page.goto('/dashboard')
    await expect(page.getByTestId('coming-up-item').filter({ hasText: 'Gym' })).toBeVisible()
  })

  test('a bill gets its end date from its dialog, which is where it is moved and taken away', async ({
    page,
    apiAs,
    billsPage,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const ends = householdDate(60)
    await billsPage.goto()
    await billsPage.addButton.click()
    await billsPage.fillIn({
      name: 'Town Water',
      account: 'Everyday checking',
      amount: '102.18',
      dueDate: householdDate(20),
      endsOn: ends,
    })
    await expect(billsPage.dialog.getByTestId('bill-ends-on')).toContainText('End date (optional)')
    await billsPage.save()

    const [bill] = await api.get<Item[]>('/bills')
    expect(bill).toMatchObject({ name: 'Town Water', ends_on: ends, cancelled_on: null })
    // It carries on until then, so it is still being tracked and says when it stops.
    const town = billsPage.card('Town Water')
    await expect(town.getByTestId('bill-end-chip')).toHaveText(`Ends ${mediumDay(ends)}`)
    await expect(town.getByTestId('bill-due')).toContainText('Due')
    await expect(page.getByTestId('bills-count')).toContainText('1')

    // Monthly from 20 days away: one more a month on, and the one after that is past the end.
    await recurringPage.goto('bill', bill!.id)
    await expect(page.getByTestId('show-status')).toHaveText('Active')
    await expect(page.getByTestId('show-ends')).toHaveText(`Ends ${mediumDay(ends)}`)
    await expect(recurringPage.upcoming.getByTestId('upcoming-payment')).toHaveCount(2)
    await expect(recurringPage.upcoming.getByTestId('upcoming-ends')).toContainText(
      `It ends on ${mediumDay(ends)}`,
    )
    await expect(page.getByTestId('show-end-alert')).toContainText(`Ends on ${mediumDay(ends)}`)
    // It hasn't stopped, so there is nothing to reactivate: its date can be moved.
    await expect(page.getByTestId('show-reactivate')).toHaveCount(0)
    await expect(page.getByTestId('show-change-end')).toBeVisible()

    // Moved, then taken away.
    await billsPage.goto()
    await billsPage.act('Town Water', 'edit')
    await expect(billsPage.dialog.getByTestId('bill-ends-on').getByRole('textbox')).toHaveValue(
      typed(ends),
    )
    await billsPage.fillIn({ endsOn: householdDate(90) })
    await billsPage.save()
    expect((await api.get<Item[]>('/bills'))[0]!.ends_on).toBe(householdDate(90))
    await billsPage.act('Town Water', 'edit')
    await billsPage.fillIn({ endsOn: '' })
    await billsPage.save()
    expect((await api.get<Item[]>('/bills'))[0]).toMatchObject({ ends_on: null })
    await expect(billsPage.card('Town Water').getByTestId('bill-end-chip')).toHaveCount(0)
  })

  test('a bill is cancelled and reactivated in a bill’s words, from its card', async ({
    page,
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    const due = householdDate(12)
    const made = await api.post<Item>(
      '/bills',
      newItem(baseline, 'City Power', { next_due_date: due, amount_varies: true }),
    )
    await billsPage.goto()

    await billsPage.act('City Power', 'cancel')
    const dialog = billsPage.page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Cancel City Power?')
    await expect(dialog.getByTestId('bill-cancel-confirm')).toHaveText('Cancel bill')
    await dialog.getByTestId('bill-cancel-confirm').click()
    await expect(dialog).toBeHidden()

    await expect(billsPage.cards).toHaveCount(0)
    await expect(page.getByTestId('bills-none-match')).toContainText('No active bills')
    await page.getByTestId('bill-filter').getByRole('button', { name: 'Cancelled' }).click()
    await expect(billsPage.card('City Power').getByTestId('bill-end-chip')).toHaveText('Cancelled')
    expect(await api.get<Item>(`/bills/${made.id}`)).toMatchObject({
      cancelled_on: householdDate(),
      ends_on: due,
    })

    await billsPage.act('City Power', 'reactivate')
    const reactivate = billsPage.page.getByRole('dialog')
    await expect(reactivate.getByRole('heading', { level: 2 })).toHaveText('Reactivate City Power?')
    await expect(reactivate.getByTestId('bill-reactivate-day')).toContainText('Next due date')
    await expect(reactivate.getByTestId('bill-reactivate-confirm')).toHaveText('Reactivate bill')
    await reactivate.getByTestId('bill-reactivate-confirm').click()
    await expect(reactivate).toBeHidden()

    await page.getByTestId('bill-filter').getByRole('button', { name: 'Active' }).click()
    await expect(billsPage.card('City Power')).toBeVisible()
    await expect(billsPage.card('City Power').getByTestId('bill-end-chip')).toHaveCount(0)
    expect(await api.get<Item>(`/bills/${made.id}`)).toMatchObject({
      active: true,
      cancelled_on: null,
      ends_on: null,
      next_due_date: due,
    })
  })

  test('what has ended is not warned of, and does not stay on the dashboard', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    // Due in two days, which is inside both the dashboard's two weeks and the three-day warning.
    const made = await api.post<Item>(
      '/subscriptions',
      newItem(baseline, 'Streamflix', { next_due_date: householdDate(2) }),
    )
    await page.goto('/dashboard')
    await expect(page.getByTestId('coming-up-item').filter({ hasText: 'Streamflix' })).toBeVisible()
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-due-alert')).toBeVisible()

    await api.post(`/subscriptions/${made.id}/cancellation`, {
      cancelled_on: householdDate(),
      ends_on: householdDate(2),
    })

    await page.goto('/dashboard')
    await expect(page.getByTestId('coming-up')).toBeVisible()
    await expect(page.getByTestId('coming-up-item')).toHaveCount(0)
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-due-alert')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-overdue-alert')).toHaveCount(0)
  })

  test('deleting says what it removes, and to cancel to keep the history unless it is cancelled already', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await page.goto('/subscriptions')

    await act(page, 'Streamflix', 'delete')
    await expect(page.getByTestId('confirm-text')).toContainText(
      'This removes Streamflix and everything set up for it',
    )
    await expect(page.getByTestId('confirm-text')).toContainText(
      'The payments themselves will stay in your history, but will no longer be linked.',
    )
    await expect(page.getByTestId('confirm-text')).toContainText(
      'To keep it and its history here, cancel the subscription instead.',
    )
    await page.getByTestId('confirm-cancel').click()
    await expect(page.getByTestId('confirm-accept')).toHaveCount(0)

    await api.post(`/subscriptions/${made.id}/cancellation`, { ends_on: householdDate(9) })
    await page.goto('/subscriptions')
    await filter(page, 'Cancelled').click()
    await act(page, 'Streamflix', 'delete')
    await expect(page.getByTestId('confirm-text')).toContainText('will stay in your history')
    await expect(page.getByTestId('confirm-text')).not.toContainText('cancel the subscription')
    await page.getByTestId('confirm-cancel').click()
  })

  test('a cancelled one still holds its payee, and says how to track it again', async ({
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${made.id}/cancellation`, { ends_on: householdDate(9) })

    await expect(api.post('/subscriptions', newItem(baseline, 'Streamflix'))).rejects.toThrow(
      /failed with 409.*A cancelled subscription already tracks this payee from this account\. Reactivate it, or delete it, to track this payee again\./,
    )
    expect(await api.get<Item[]>('/subscriptions')).toHaveLength(1)
  })

  test('only an admin can cancel or reactivate, and each is refused when it does not apply', async ({
    baseline,
    apiAs,
  }) => {
    const admin = await apiAs('admin')
    const viewer = await apiAs('viewer')
    const made = await admin.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    const cancel = `/subscriptions/${made.id}/cancellation`
    const reactivate = `/subscriptions/${made.id}/reactivation`

    await expect(viewer.post(cancel, {})).rejects.toThrow(/failed with 403/)
    await expect(viewer.post(reactivate, {})).rejects.toThrow(/failed with 403/)
    // It hasn't stopped, so there is nothing to reactivate.
    await expect(admin.post(reactivate, {})).rejects.toThrow(
      /failed with 409.*nothing to reactivate/,
    )
    // The wrong kind of thing is as good as nothing there.
    await expect(admin.post(`/bills/${made.id}/cancellation`, {})).rejects.toThrow(
      /failed with 404/,
    )
    await expect(admin.post(`/bills/${made.id}/reactivation`, {})).rejects.toThrow(
      /failed with 404/,
    )
    // Dates the API doesn't take, and fields it doesn't know.
    await expect(admin.post(cancel, { ends_on: '2200-01-01' })).rejects.toThrow(/failed with 422/)
    await expect(admin.post(cancel, { ends_on: 'soon' })).rejects.toThrow(/failed with 422/)
    await expect(admin.post(cancel, { active: false })).rejects.toThrow(/failed with 422/)
    await expect(admin.post(reactivate, { next_due_date: '2200-01-01' })).rejects.toThrow(
      /failed with 422/,
    )
    await expect(admin.post(reactivate, { active: true })).rejects.toThrow(/failed with 422/)
    expect(await admin.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      cancelled_on: null,
      ends_on: null,
    })

    await admin.post(cancel, { ends_on: householdDate(9) })
    // Cancelled once, so it can't be again, nor lose the day it ends.
    await expect(admin.post(cancel, {})).rejects.toThrow(/failed with 409.*already cancelled/)
    await expect(admin.patch(`/subscriptions/${made.id}`, { ends_on: null })).rejects.toThrow(
      /failed with 422.*Reactivate it/,
    )
    expect(await admin.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      ends_on: householdDate(9),
    })

    // Reactivated, it is a regular one: no end, tracked, and it can't be reactivated again.
    const back = await admin.post<Item>(reactivate, { today: householdDate() })
    expect(back).toMatchObject({ cancelled_on: null, ends_on: null, active: true })
    await expect(admin.post(reactivate, {})).rejects.toThrow(/failed with 409/)
  })
})

test.describe('Cancelling and reactivating subscriptions and bills, as a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a viewer sees how it ended, with nothing to change it', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${made.id}/cancellation`, { ends_on: householdDate(9) })

    await recurringPage.goto('subscription', made.id)
    await expect(page.getByTestId('show-status')).toHaveText('Cancelled')
    await expect(page.getByTestId('show-end-alert')).toBeVisible()
    await expect(page.getByTestId('show-reactivate')).toHaveCount(0)
    await expect(page.getByTestId('show-actions')).toHaveCount(0)
    await page.goto('/subscriptions')
    await filter(page, 'Cancelled').click()
    await expect(card(page, 'Streamflix').getByTestId('subscription-actions')).toHaveCount(0)
  })
})
