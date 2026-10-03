import { flushPromises } from '@vue/test-utils'

import * as subscriptionsApi from '@/api/subscriptions'
import type { Subscription } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { answer } from '@/test/confirm'
import { checking, makeAccount, makePage, seedFinance } from '@/test/finance'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
import { makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { addDays, todayIso } from '@/utils/dates'
import SubscriptionsView from '@/views/SubscriptionsView.vue'

interface Options {
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
  role = 'admin',
  items = [],
  fail = false,
  alerts = {},
  accounts = [checking],
  pending = false,
  withoutPreferences = false,
  deferred,
}: Options = {}) {
  const fetch = vi.spyOn(subscriptionsApi, 'fetchSubscriptions')
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
    route: '/subscriptions',
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      const seeded = seedFinance({ accounts })
      if (withoutPreferences) {
        seeded.preferences.saved = null
        seeded.preferences.load = vi.fn()
      } else {
        seeded.preferences.saved = makePreferences()
        seeded.preferences.saved.alerts.subscription_due_enabled = alerts.enabled ?? true
        seeded.preferences.saved.alerts.subscription_due_days_before = alerts.days ?? 3
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
    const { find } = await render({ role: 'viewer', pending: true })
    expect(find('subscriptions-loading').exists()).toBe(true)
    expect(find('read-only-notice').text()).toContain('Only an admin can change them')
    expect(find('subscription-add').exists()).toBe(false)
    expect(find('subscription-add-first').exists()).toBe(false)
  })

  it('keeps totals useful when account currency data is unavailable', async () => {
    const subscription = makeSubscription({ account_id: 'deleted-account' })
    const { find } = await render({ items: [subscription], accounts: [] })
    expect(find('subscriptions-monthly').text()).toContain('$14.99')
    expect(find('subscription-card').text()).toContain('Account unavailable')
  })
})
