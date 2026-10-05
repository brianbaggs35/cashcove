import { flushPromises } from '@vue/test-utils'

import type { MockInstance } from 'vitest'

import * as billsApi from '@/api/bills'
import * as subscriptionsApi from '@/api/subscriptions'
import type { RecurringKind, Subscription } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { checking, makeAccount, makePage, seedFinance } from '@/test/finance'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { addDays, todayIso } from '@/utils/dates'
import SubscriptionsView from '@/views/SubscriptionsView.vue'

interface Options {
  /** Which page: subscriptions, or bills. */
  kind?: RecurringKind
  role?: 'admin' | 'viewer'
  items?: Subscription[]
  fail?: boolean
  alerts?: { enabled?: boolean; days?: number }
  accounts?: (typeof checking)[]
  pending?: boolean
  withoutPreferences?: boolean
  deferred?: {
    requests: {
      resolve: (subscriptions: Subscription[]) => void
      reject: (reason?: unknown) => void
    }[]
  }
}

async function render({
  kind = 'subscription',
  role = 'admin',
  items = [],
  fail = false,
  alerts = {},
  accounts = [checking],
  pending = false,
  withoutPreferences = false,
  deferred,
}: Options = {}) {
  const fetch = (
    kind === 'bill'
      ? vi.spyOn(billsApi, 'fetchBills')
      : vi.spyOn(subscriptionsApi, 'fetchSubscriptions')
  ) as MockInstance<(active?: boolean) => Promise<Subscription[]>>
  // Dialogs name what payments are linked to from both, so the other kind is listed too.
  if (kind === 'bill') vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([])
  else vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([])
  if (deferred) {
    fetch.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          deferred.requests.push({ resolve, reject })
        }),
    )
  } else if (fail)
    fetch.mockRejectedValueOnce(new Error('Temporary problem')).mockResolvedValue(items)
  else if (pending) fetch.mockReturnValue(new Promise(() => undefined))
  else fetch.mockResolvedValue(items)
  vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
  const mounted = await mountWithPlugins(SubscriptionsView, {
    width: 1280,
    props: { kind },
    route: kind === 'bill' ? '/bills' : '/subscriptions',
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      const seeded = seedFinance({ accounts })
      if (withoutPreferences) {
        seeded.preferences.saved = null
        seeded.preferences.load = vi.fn()
      } else {
        const saved = makePreferences()
        seeded.preferences.saved = saved
        // The reminders are kept apart: turning off the other kind's changes nothing here.
        saved.alerts.subscription_due_enabled = kind === 'bill' ? false : (alerts.enabled ?? true)
        saved.alerts.subscription_due_days_before = alerts.days ?? 3
        saved.alerts.bill_due_enabled = kind === 'bill' ? (alerts.enabled ?? true) : false
        saved.alerts.bill_due_days_before = alerts.days ?? 5
      }
    },
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => wrapper.findComponent({ name })
  return { ...mounted, fetch, find, component }
}

describe('SubscriptionsView', () => {
  it('invites admins to add their first subscription', async () => {
    const { find, component } = await render()

    expect(find('empty-state').text()).toContain('Know what’s coming up')
    expect(find('subscription-add').exists()).toBe(false)
    await find('subscription-add-first').trigger('click')
    await flushPromises()
    const dialog = component('SubscriptionDialog')
    expect(dialog.props('modelValue')).toBe(true)
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(dialog.props('modelValue')).toBe(false)
  })

  it('shows totals by currency, next payments, and the configured due reminder', async () => {
    const first = makeSubscription({ next_due_date: addDays(todayIso(), 2) })
    const cadAccount = makeAccount({
      id: 'account-cad',
      name: 'Canadian card',
      currency: 'CAD',
    })
    const second = makeSubscription({
      id: 'subscription-annual',
      name: 'Annual storage',
      payee: 'Annual storage',
      amount: '120.00',
      frequency: 'annual',
      account_id: cadAccount.id,
      next_due_date: addDays(todayIso(), 15),
      category_id: null,
    })
    const { find, wrapper } = await render({
      items: [first, second],
      accounts: [checking, cadAccount],
      alerts: { days: 2 },
    })

    expect(find('subscriptions-count').text()).toContain('2')
    expect(find('subscriptions-monthly').text()).toContain('$14.99')
    expect(find('subscriptions-monthly').text()).toContain('CA$10.00')
    expect(find('subscriptions-yearly').text()).toContain('$179.88')
    expect(find('subscriptions-yearly').text()).toContain('CA$120.00')
    expect(find('subscriptions-due-alert').text()).toContain('1 payment is due')
    expect(wrapper.findAll('[data-test="subscription-card"]')).toHaveLength(2)
    expect(find('subscription-due-alert').exists()).toBe(true)
    expect(find('subscriptions-due-alert').find('a').attributes('href')).toBe('/settings/alerts')
  })

  it('hides the page reminder when settings turn it off', async () => {
    const subscription = makeSubscription({ next_due_date: todayIso() })
    const { find } = await render({ items: [subscription], alerts: { enabled: false } })
    expect(find('subscriptions-due-alert').exists()).toBe(false)
    expect(find('subscription-due-alert').exists()).toBe(false)
  })

  it('uses alert defaults when preferences are not loaded', async () => {
    const subscription = makeSubscription({ next_due_date: addDays(todayIso(), 2) })
    const { find } = await render({ items: [subscription], withoutPreferences: true })
    expect(find('subscriptions-due-alert').exists()).toBe(false)
    expect(find('subscription-due-alert').exists()).toBe(false)
  })

  it('shows dashes for estimates when every subscription is paused', async () => {
    const paused = makeSubscription({ active: false })
    const { find } = await render({ items: [paused] })
    expect(find('subscriptions-monthly').text()).toContain('—')
    expect(find('subscriptions-yearly').text()).toContain('—')
  })

  it('uses plural reminder text and ignores overdue payments', async () => {
    const subscriptions = [
      makeSubscription({ next_due_date: addDays(todayIso(), 1) }),
      makeSubscription({
        id: 'subscription-next',
        next_due_date: addDays(todayIso(), 2),
      }),
      makeSubscription({
        id: 'subscription-overdue',
        next_due_date: addDays(todayIso(), -1),
      }),
    ]
    const { find, wrapper } = await render({ items: subscriptions, alerts: { days: 3 } })
    expect(find('subscriptions-due-alert').text()).toContain('2 payments are due')
    expect(wrapper.findAll('[data-test="subscription-due-alert"]')).toHaveLength(2)
  })

  it('searches names and payees, and switches between active and paused subscriptions', async () => {
    const active = makeSubscription()
    const paused = makeSubscription({
      id: 'subscription-paused',
      name: 'Paused membership',
      payee: 'Old Merchant',
      active: false,
    })
    const { find } = await render({ items: [active, paused] })

    expect(find('subscription-card').exists()).toBe(true)
    await find('subscription-search').find('input').setValue('merchant')
    await flushPromises()
    expect(find('subscription-card').exists()).toBe(false)
    await find('subscription-filter').findAll('button').at(1)!.trigger('click')
    await flushPromises()
    expect(find('subscription-card').text()).toContain('Paused membership')
    await find('subscription-search').find('input').setValue('  ')
    await flushPromises()
    expect(find('subscription-card').text()).toContain('Paused membership')
  })

  it('shows a no-results state for a search with no matches', async () => {
    const { find } = await render({ items: [makeSubscription()] })
    await find('subscription-search').find('input').setValue('not here')
    await flushPromises()
    expect(find('empty-state').text()).toContain('No matches')
  })

  it('opens an existing subscription for editing and refreshes after it saves', async () => {
    const subscription = makeSubscription()
    const { component, fetch } = await render({ items: [subscription] })
    const dialog = component('SubscriptionDialog')
    component('SubscriptionCard').vm.$emit('edit', subscription)
    await flushPromises()
    expect(dialog.props()).toMatchObject({ modelValue: true, subscription })

    dialog.vm.$emit('saved', subscription)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('opens the payments dialog to link payments to a subscription, and reloads as it changes', async () => {
    const subscription = makeSubscription()
    const { component, fetch } = await render({ items: [subscription] })

    component('SubscriptionCard').vm.$emit('link', subscription)
    await flushPromises()
    const dialog = component('SubscriptionPaymentsDialog')
    expect(dialog.props()).toMatchObject({ modelValue: true, subscription })
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(dialog.props('modelValue')).toBe(false)

    // The dialog loads the names of subscriptions for itself, so count from here.
    const before = fetch.mock.calls.length
    dialog.vm.$emit('changed', subscription)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(before + 1)
  })

  it('opens the header action to add another subscription', async () => {
    const { find, component } = await render({ items: [makeSubscription()] })
    await find('subscription-add').trigger('click')
    await flushPromises()
    expect(component('SubscriptionDialog').props('modelValue')).toBe(true)
  })

  it('ignores stale subscription responses and errors', async () => {
    const subscription = makeSubscription()
    const deferred: NonNullable<Options['deferred']> = { requests: [] }
    const { component, find } = await render({ deferred })
    expect(deferred.requests).toHaveLength(1)

    const dialog = component('SubscriptionDialog')
    dialog.vm.$emit('saved', subscription)
    await flushPromises()
    expect(deferred.requests).toHaveLength(2)
    deferred.requests[1]!.resolve([subscription])
    await flushPromises()
    deferred.requests[0]!.resolve([])
    await flushPromises()
    expect(find('subscription-title').text()).toBe(subscription.name)

    dialog.vm.$emit('saved', subscription)
    dialog.vm.$emit('saved', subscription)
    await flushPromises()
    expect(deferred.requests).toHaveLength(4)
    deferred.requests[3]!.resolve([subscription])
    await flushPromises()
    deferred.requests[2]!.reject(new Error('An obsolete request failed'))
    await flushPromises()
    expect(find('subscriptions-error').exists()).toBe(false)
    expect(find('subscription-title').text()).toBe(subscription.name)
  })

  it('counts a bill that changes every time by what it is expected to be', async () => {
    const power = makeSubscription({
      name: 'Power',
      amount: '100.00',
      amount_varies: true,
      expected_amount: '120.00',
    })
    const { find } = await render({ items: [power] })

    expect(find('subscriptions-monthly').text()).toContain('$120.00')
    expect(find('subscriptions-yearly').text()).toContain('$1,440.00')
  })

  it('updates a subscription to the amount last paid, once asked', async () => {
    const subscription = makeSubscription({ amount: '15.49', last_payment_amount: '17.99' })
    const update = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockResolvedValueOnce({ ...subscription, amount: '17.99' })
      .mockRejectedValueOnce(new Error('No connection'))
    const { component, find, fetch } = await render({ items: [subscription] })

    component('SubscriptionCard').vm.$emit('update-amount', subscription)
    await flushPromises()
    expect(update).toHaveBeenCalledWith(subscription.id, { amount: '17.99' })
    expect(notices.value.at(-1)?.text).toBe('Updated Streamflix to $17.99')
    expect(fetch).toHaveBeenCalledTimes(2)

    component('SubscriptionCard').vm.$emit('update-amount', subscription)
    await flushPromises()
    expect(find('subscriptions-error').text()).toContain('No connection')
    // With no payment to go by there's nothing to update to.
    component('SubscriptionCard').vm.$emit('update-amount', {
      ...subscription,
      last_payment_amount: null,
    })
    await flushPromises()
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('pauses and resumes automatic matching, reporting update errors', async () => {
    const subscription = makeSubscription()
    const update = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockResolvedValueOnce({ ...subscription, active: false })
      .mockResolvedValueOnce({ ...subscription, active: true })
      .mockRejectedValueOnce(new Error('No connection'))
    const { component, find, fetch } = await render({ items: [subscription] })
    component('SubscriptionCard').vm.$emit('toggle', subscription)
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(subscription.id, { active: false })
    expect(fetch).toHaveBeenCalledTimes(2)

    const paused = { ...subscription, active: false }
    component('SubscriptionCard').vm.$emit('toggle', paused)
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(subscription.id, { active: true })

    component('SubscriptionCard').vm.$emit('toggle', subscription)
    await flushPromises()
    expect(find('subscriptions-error').text()).toContain('No connection')
  })

  it('deletes after confirmation, but leaves the list alone when cancelled', async () => {
    const subscription = makeSubscription()
    const remove = vi.spyOn(subscriptionsApi, 'deleteSubscription').mockResolvedValue(undefined)
    const { component, fetch } = await render({ items: [subscription] })
    component('SubscriptionCard').vm.$emit('delete', subscription)
    await flushPromises()
    expect(confirmRequest.value?.title).toBe('Delete Streamflix?')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()

    component('SubscriptionCard').vm.$emit('delete', subscription)
    await flushPromises()
    await answer(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(subscription.id)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows an error and retries the subscription list', async () => {
    const subscription = makeSubscription()
    const { fetch, find } = await render({ items: [subscription], fail: true })
    expect(find('subscriptions-error').text()).toContain('Temporary problem')
    await find('subscriptions-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('subscription-title').text()).toBe(subscription.name)
  })

  it('shows loading feedback and read-only access for viewers', async () => {
    const { find, component } = await render({ role: 'viewer', pending: true })
    expect(find('subscriptions-loading').exists()).toBe(true)
    expect(find('read-only-notice').text()).toContain('Only an admin can change them')
    expect(find('subscription-add').exists()).toBe(false)
    expect(find('subscription-add-first').exists()).toBe(false)
    expect(component('SubscriptionDialog').exists()).toBe(false)
    expect(component('SubscriptionPaymentsDialog').exists()).toBe(false)
  })

  it('keeps totals useful when account currency data is unavailable', async () => {
    const subscription = makeSubscription({ account_id: 'deleted-account' })
    const { find } = await render({ items: [subscription], accounts: [] })
    expect(find('subscriptions-monthly').text()).toContain('$14.99')
    expect(find('subscription-card').text()).toContain('Account unavailable')
  })

  describe('for bills', () => {
    const overdue = (days: number) => addDays(todayIso(), -days)

    it('invites admins to add their first bill, in its own words', async () => {
      const { find, component, wrapper } = await render({ kind: 'bill' })

      expect(wrapper.find('h1').text()).toBe('Bills')
      expect(find('empty-state').text()).toContain('Never miss a due date')
      expect(find('bill-add').exists()).toBe(false)
      expect(find('subscription-add-first').exists()).toBe(false)
      await find('bill-add-first').trigger('click')
      await flushPromises()
      expect(component('SubscriptionDialog').props()).toMatchObject({
        modelValue: true,
        kind: 'bill',
        subscription: null,
      })
    })

    it('lists the bills with totals, and warns by the bills’ own reminder', async () => {
      const power = makeBill({ next_due_date: addDays(todayIso(), 4) })
      const phone = makeBill({
        id: 'bill-phone',
        name: 'Phone',
        amount: '55.00',
        amount_varies: false,
        expected_amount: '55.00',
        next_due_date: addDays(todayIso(), 20),
      })
      const { find, wrapper } = await render({ kind: 'bill', items: [power, phone] })

      expect(find('bills-count').text()).toContain('Active bills')
      expect(find('bills-count').text()).toContain('2')
      expect(find('bills-monthly').text()).toContain('$151.40')
      expect(find('bills-yearly').text()).toContain('$1,816.80')
      // Within the 5 days bills warn before, which subscriptions' 3 days wouldn't reach.
      expect(find('bills-due-alert').text()).toContain('1 payment is due within your 5-day')
      expect(wrapper.findAll('[data-test="bill-card"]')).toHaveLength(2)
      expect(wrapper.findAll('[data-test="subscription-card"]')).toHaveLength(0)
      expect(wrapper.findAllComponents({ name: 'SubscriptionCard' })[0]!.props()).toMatchObject({
        alertDays: 5,
        dueAlertsEnabled: true,
      })
    })

    it('hides the reminder when the settings for bills turn it off, whatever subscriptions do', async () => {
      const bill = makeBill({ next_due_date: todayIso() })
      const { find } = await render({ kind: 'bill', items: [bill], alerts: { enabled: false } })

      expect(find('bills-due-alert').exists()).toBe(false)
      expect(find('bill-due-alert').exists()).toBe(false)
    })

    it('warns of bills past their due date without a payment linked', async () => {
      const one = await render({
        kind: 'bill',
        items: [makeBill({ next_due_date: overdue(3) })],
      })
      expect(one.find('bills-overdue-alert').text()).toContain(
        '1 bill is past its due date without a payment linked.',
      )
      expect(one.find('bill-due').classes()).toContain('text-error')

      const several = await render({
        kind: 'bill',
        items: [
          makeBill({ next_due_date: overdue(3) }),
          makeBill({ id: 'bill-water', name: 'Water', next_due_date: overdue(1) }),
          makeBill({ id: 'bill-gas', name: 'Gas', active: false, next_due_date: overdue(9) }),
          makeBill({ id: 'bill-phone', name: 'Phone', next_due_date: addDays(todayIso(), 9) }),
        ],
      })
      // A paused one isn't being tracked, so it isn't late, and one due later isn't either.
      expect(several.find('bills-overdue-alert').text()).toContain(
        '2 bills are past their due date without a payment linked.',
      )
      expect(several.find('bills-due-alert').exists()).toBe(false)
    })

    it('says so for subscriptions too, and nothing when none are late', async () => {
      const late = await render({ items: [makeSubscription({ next_due_date: overdue(2) })] })
      expect(late.find('subscriptions-overdue-alert').text()).toContain(
        '1 subscription is past its due date',
      )

      const fine = await render({ items: [makeSubscription()] })
      expect(fine.find('subscriptions-overdue-alert').exists()).toBe(false)
    })

    it('searches the bills and shows paused ones apart', async () => {
      const { find, wrapper } = await render({
        kind: 'bill',
        items: [makeBill(), makeBill({ id: 'bill-gas', name: 'Gas', active: false })],
      })
      expect(find('bill-search').find('label').text()).toBe('Search bills')
      expect(find('bill-filter').attributes('aria-label')).toBe('Bill status')
      expect(wrapper.findAll('[data-test="bill-title"]').map((item) => item.text())).toEqual([
        'City Power',
      ])

      await find('bill-filter').findAll('button').at(1)!.trigger('click')
      await flushPromises()
      expect(wrapper.findAll('[data-test="bill-title"]').map((item) => item.text())).toEqual([
        'Gas',
      ])

      await find('bill-search').find('input').setValue('nothing like it')
      await flushPromises()
      expect(find('bills-none-match').text()).toContain('active and paused bills')
    })

    it('changes, pauses, links and deletes through the bills API', async () => {
      const bill = makeBill()
      const update = vi.spyOn(billsApi, 'updateBill').mockResolvedValue({ ...bill, active: false })
      const remove = vi.spyOn(billsApi, 'deleteBill').mockResolvedValue(undefined)
      const updateSubscription = vi.spyOn(subscriptionsApi, 'updateSubscription')
      const { component, fetch } = await render({ kind: 'bill', items: [bill] })

      component('SubscriptionCard').vm.$emit('toggle', bill)
      await flushPromises()
      expect(update).toHaveBeenCalledWith('bill-power', { active: false })
      expect(fetch).toHaveBeenCalledTimes(2)

      component('SubscriptionCard').vm.$emit('update-amount', {
        ...bill,
        last_payment_amount: '110.00',
      })
      await flushPromises()
      expect(update).toHaveBeenLastCalledWith('bill-power', { amount: '110.00' })
      expect(notices.value.at(-1)?.text).toBe('Updated City Power to $110.00')

      component('SubscriptionCard').vm.$emit('link', bill)
      await flushPromises()
      expect(component('SubscriptionPaymentsDialog').props('subscription')).toEqual(bill)

      component('SubscriptionCard').vm.$emit('delete', bill)
      await flushPromises()
      expect(confirmRequest.value).toMatchObject({
        title: 'Delete City Power?',
        confirmText: 'Delete bill',
      })
      await answer(true)
      await flushPromises()
      expect(remove).toHaveBeenCalledWith('bill-power')
      expect(notices.value.at(-1)?.text).toBe('Deleted City Power')
      expect(updateSubscription).not.toHaveBeenCalled()
    })

    it('says what viewers may do in terms of bills', async () => {
      const { wrapper } = await render({ kind: 'bill', role: 'viewer', items: [makeBill()] })

      expect(wrapper.text()).toContain('You can see bills. Only an admin can change them.')
      expect(wrapper.find('[data-test="bill-add"]').exists()).toBe(false)
    })

    it('says what went wrong loading the bills, and tries again', async () => {
      const { find, fetch } = await render({ kind: 'bill', items: [makeBill()], fail: true })

      expect(find('bills-error').text()).toContain("Couldn't load or update bills")
      await find('bills-retry').trigger('click')
      await flushPromises()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(find('bills-error').exists()).toBe(false)
    })
  })
})
