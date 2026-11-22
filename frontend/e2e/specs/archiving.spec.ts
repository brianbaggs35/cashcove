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
  ends_on: string | null
  cancelled_on: string | null
  archived_on: string | null
  payment_count: number
}

/** What the API takes to make a subscription or a bill, paid from checking. */
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
async function act(page: Page, name: string, action: 'archive' | 'unarchive' | 'toggle') {
  await card(page, name).getByTestId('subscription-actions').click()
  await openOverlays(page).getByTestId(`subscription-${action}`).click()
}

const filter = (page: Page, name: 'Active' | 'Paused' | 'Cancelled' | 'Archived') =>
  page.getByTestId('subscription-filter').getByRole('button', { name })

test.describe('Archiving subscriptions and bills', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a subscription is archived from its card, and it and its payments are kept', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await pay(api, baseline, 'Streamflix', 40)
    await pay(api, baseline, 'Streamflix', 10)
    await page.goto('/subscriptions')
    await expect(page.getByTestId('subscriptions-count')).toContainText('1')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('$14.99')

    await act(page, 'Streamflix', 'archive')

    // It has left what is tracked and paid, so the count and the totals no longer have it, and the
    // list of active ones says what the filter is for.
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-none-match')).toContainText(
      'No active subscriptions',
    )
    await expect(page.getByTestId('subscriptions-count')).toContainText('0')
    await expect(page.getByTestId('subscriptions-monthly')).toContainText('—')
    // It isn't under Paused either: it is only in the archive, with its payments.
    await filter(page, 'Paused').click()
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await filter(page, 'Archived').click()
    const archived = card(page, 'Streamflix')
    await expect(archived.getByTestId('subscription-archived-chip')).toHaveText('Archived')
    await expect(archived.getByTestId('subscription-paused-chip')).toHaveText('Paused')
    await expect(archived.getByTestId('subscription-payment-count')).toContainText(
      '2 payments tracked',
    )
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      archived_on: householdDate(),
      active: false,
      payment_count: 2,
    })

    // The menu offers to bring it back where it offered to change how it is tracked.
    await archived.getByTestId('subscription-actions').click()
    const menu = openOverlays(page)
    await expect(menu.getByTestId('subscription-unarchive')).toHaveText('Unarchive subscription')
    await expect(menu.getByTestId('subscription-archive')).toHaveCount(0)
    await expect(menu.getByTestId('subscription-toggle')).toHaveCount(0)
    await expect(menu.getByTestId('subscription-cancel')).toHaveCount(0)
    await page.keyboard.press('Escape')
  })

  test('it comes back as it was, paused, and is resumed from its card', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${made.id}/archiving`, { today: householdDate() })
    await page.goto('/subscriptions')
    await filter(page, 'Archived').click()

    await act(page, 'Streamflix', 'unarchive')

    // It left the archive, and is waiting to be resumed, since archiving paused it.
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await expect(page.getByTestId('subscriptions-none-match')).toContainText(
      'No archived subscriptions',
    )
    await filter(page, 'Paused').click()
    await expect(card(page, 'Streamflix').getByTestId('subscription-archived-chip')).toHaveCount(0)
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      archived_on: null,
      active: false,
    })

    await act(page, 'Streamflix', 'toggle')
    await filter(page, 'Active').click()
    await expect(card(page, 'Streamflix')).toBeVisible()
    await expect(page.getByTestId('subscriptions-count')).toContainText('1')
  })

  test('its page says it is archived, keeps its payments, and brings it back from there', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await pay(api, baseline, 'Streamflix', 40)
    await pay(api, baseline, 'Streamflix', 10)
    await recurringPage.goto('subscription', made.id)
    await expect(page.getByTestId('show-status')).toHaveText('Active')

    await recurringPage.act('archive')

    await expect(page.getByTestId('show-archived')).toHaveText('Archived')
    await expect(page.getByTestId('show-status')).toHaveText('Paused')
    await expect(page.getByTestId('show-archived-alert')).toContainText(
      'This subscription and every payment it tracked are kept',
    )
    // It says it is archived instead of paused, and its history is all still there.
    await expect(page.getByTestId('show-paused-alert')).toHaveCount(0)
    await expect(recurringPage.paymentRows).toHaveCount(2)
    await expect(recurringPage.stat('paid')).toContainText('$29.98')
    await expectAccessible(page)

    // Its menu has only what brings it back, and deleting.
    await page.getByTestId('show-actions').click()
    const menu = openOverlays(page)
    await expect(menu.getByTestId('show-unarchive-item')).toBeVisible()
    await expect(menu.getByTestId('show-archive')).toHaveCount(0)
    await expect(menu.getByTestId('show-toggle')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.getByTestId('show-unarchive').click()
    await expect(page.getByTestId('show-archived')).toHaveCount(0)
    await expect(page.getByTestId('show-archived-alert')).toHaveCount(0)
    await expect(page.getByTestId('show-paused-alert')).toBeVisible()
    await expect(recurringPage.paymentRows).toHaveCount(2)
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      archived_on: null,
      active: false,
      payment_count: 2,
    })
  })

  test('a bill is archived from its card and listed in the archive, in the bills’ words', async ({
    baseline,
    apiAs,
    billsPage,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/bills', newItem(baseline, 'City Power'))
    await billsPage.goto()

    await billsPage.act('City Power', 'archive')

    await expect(billsPage.cards).toHaveCount(0)
    await billsPage.show('Archived')
    await expect(billsPage.card('City Power').getByTestId('bill-archived-chip')).toBeVisible()
    expect(await api.get<Item>(`/bills/${made.id}`)).toMatchObject({ archived_on: householdDate() })

    await billsPage.act('City Power', 'unarchive')
    await expect(billsPage.cards).toHaveCount(0)
    await billsPage.show('Paused')
    await expect(billsPage.card('City Power')).toBeVisible()
  })

  test('one that was cancelled is archived as it is, and stays cancelled when it is brought back', async ({
    page,
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Old gym'))
    await api.post(`/subscriptions/${made.id}/cancellation`, {
      cancelled_on: householdDate(-12),
      ends_on: householdDate(-10),
    })
    await api.post(`/subscriptions/${made.id}/archiving`, { today: householdDate() })

    // It had stopped, so archiving left it matching a late last payment instead of pausing it.
    expect(await api.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      active: true,
      cancelled_on: householdDate(-12),
      archived_on: householdDate(),
    })
    await page.goto('/subscriptions')
    await filter(page, 'Cancelled').click()
    await expect(page.getByTestId('subscription-card')).toHaveCount(0)
    await filter(page, 'Archived').click()
    await expect(card(page, 'Old gym').getByTestId('subscription-end-chip')).toHaveText('Cancelled')

    await act(page, 'Old gym', 'unarchive')
    await filter(page, 'Cancelled').click()
    await expect(card(page, 'Old gym')).toBeVisible()
  })

  test('an archived one still holds its payee, and says how to track it again', async ({
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${made.id}/archiving`, { today: householdDate() })

    await expect(api.post('/subscriptions', newItem(baseline, 'Streamflix'))).rejects.toThrow(
      /failed with 409.*An archived subscription already tracks this payee from this account\. Unarchive it, or delete it, to track this payee again\./,
    )
    expect(await api.get<Item[]>('/subscriptions')).toHaveLength(1)
  })

  test('resuming, reactivating or giving it a new end takes it out of the archive', async ({
    baseline,
    apiAs,
  }) => {
    const api = await apiAs('admin')
    const resumed = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${resumed.id}/archiving`, { today: householdDate() })
    expect(await api.patch<Item>(`/subscriptions/${resumed.id}`, { active: true })).toMatchObject({
      archived_on: null,
      active: true,
    })

    const ended = await api.post<Item>('/subscriptions', newItem(baseline, 'Old gym'))
    await api.post(`/subscriptions/${ended.id}/cancellation`, {
      cancelled_on: householdDate(-12),
      ends_on: householdDate(-10),
    })
    await api.post(`/subscriptions/${ended.id}/archiving`, { today: householdDate() })
    const back = await api.post<Item>(`/subscriptions/${ended.id}/reactivation`, {
      today: householdDate(),
    })
    expect(back).toMatchObject({ archived_on: null, cancelled_on: null, active: true })

    // Changing what has nothing to do with it leaves it archived.
    const kept = await api.post<Item>('/subscriptions', newItem(baseline, 'Gym', { payee: 'Gym' }))
    await api.post(`/subscriptions/${kept.id}/archiving`, { today: householdDate() })
    expect(
      await api.patch<Item>(`/subscriptions/${kept.id}`, { name: 'Gym membership' }),
    ).toMatchObject({ archived_on: householdDate() })
  })

  test('only an admin can archive or unarchive, and each is refused when it does not apply', async ({
    baseline,
    apiAs,
  }) => {
    const admin = await apiAs('admin')
    const viewer = await apiAs('viewer')
    const made = await admin.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    const archive = `/subscriptions/${made.id}/archiving`
    const unarchive = `/subscriptions/${made.id}/unarchiving`

    await expect(viewer.post(archive, {})).rejects.toThrow(/failed with 403/)
    await expect(viewer.post(unarchive)).rejects.toThrow(/failed with 403/)
    // It isn't archived, so there is nothing to bring back.
    await expect(admin.post(unarchive)).rejects.toThrow(/failed with 409.*isn't archived/)
    // The wrong kind of thing is as good as nothing there.
    await expect(admin.post(`/bills/${made.id}/archiving`, {})).rejects.toThrow(/failed with 404/)
    await expect(admin.post(`/bills/${made.id}/unarchiving`)).rejects.toThrow(/failed with 404/)
    // A day the API doesn't take, and fields it doesn't know.
    await expect(admin.post(archive, { today: 'soon' })).rejects.toThrow(/failed with 422/)
    await expect(admin.post(archive, { active: false })).rejects.toThrow(/failed with 422/)
    expect(await admin.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({ archived_on: null })

    await admin.post(archive, { today: householdDate() })
    // Archived once, so it can't be again.
    await expect(admin.post(archive, {})).rejects.toThrow(/failed with 409.*already archived/)
    expect(await admin.get<Item>(`/subscriptions/${made.id}`)).toMatchObject({
      archived_on: householdDate(),
    })
  })
})

test.describe('Archiving subscriptions and bills, as a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('a viewer sees that it is archived, with nothing to change it', async ({
    page,
    baseline,
    apiAs,
    recurringPage,
  }) => {
    const api = await apiAs('admin')
    const made = await api.post<Item>('/subscriptions', newItem(baseline, 'Streamflix'))
    await api.post(`/subscriptions/${made.id}/archiving`, { today: householdDate() })

    await recurringPage.goto('subscription', made.id)
    await expect(page.getByTestId('show-archived')).toHaveText('Archived')
    await expect(page.getByTestId('show-archived-alert')).toBeVisible()
    await expect(page.getByTestId('show-unarchive')).toHaveCount(0)
    await expect(page.getByTestId('show-actions')).toHaveCount(0)
    await page.goto('/subscriptions')
    await filter(page, 'Archived').click()
    await expect(card(page, 'Streamflix').getByTestId('subscription-actions')).toHaveCount(0)
  })
})
