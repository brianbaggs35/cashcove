import { flushPromises } from '@vue/test-utils'

import * as billsApi from '@/api/bills'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import type { RecurringKind, RecurringOverview } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { page } from '@/test/dom'
import { checking, makePage, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeOverview, makeSubscription } from '@/test/subscriptions'
import { addDays, todayIso } from '@/utils/dates'
import SubscriptionView from '@/views/SubscriptionView.vue'

const inDays = (days: number) => addDays(todayIso(), days)

interface Options {
  kind?: RecurringKind
  role?: 'admin' | 'viewer'
  /** What the API says, or an error for it to fail with. */
  overview?: RecurringOverview | Error
  changes?: Parameters<typeof makeSubscription>[0]
  withoutPreferences?: boolean
}

async function render({
  kind = 'subscription',
  role = 'admin',
  changes = {},
  withoutPreferences = false,
  ...rest
}: Options = {}) {
  const item =
    kind === 'bill'
      ? makeBill({ next_due_date: inDays(20), ...changes })
      : makeSubscription({ next_due_date: inDays(20), ...changes })
  const overview = rest.overview ?? makeOverview(item)
  const spy =
    kind === 'bill'
      ? vi.spyOn(billsApi, 'fetchBillOverview')
      : vi.spyOn(subscriptionsApi, 'fetchSubscriptionOverview')
  if (overview instanceof Error) spy.mockRejectedValue(overview)
  else spy.mockResolvedValue(overview)
  vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([])
  const mounted = await mountWithPlugins(SubscriptionView, {
    width: 1280,
    props: { kind, id: item.id },
    route: `/${kind}s/${item.id}`,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      const seeded = seedFinance({ accounts: [checking] })
      if (withoutPreferences) {
        seeded.preferences.saved = null
        seeded.preferences.load = vi.fn()
      }
    },
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => wrapper.findComponent({ name })
  /** Opens the actions menu and presses an item of it, as a person would. */
  const choose = async (item: string) => {
    await find('show-actions').trigger('click')
    await flushPromises()
    await page().find(`[data-test="${item}"]`).trigger('click')
    await flushPromises()
  }
  return { ...mounted, item, spy, find, component, choose }
}

describe('SubscriptionView', () => {
  it('shows it in full: who it is, what it costs, its payments, what is coming and its details', async () => {
    const { wrapper, find, spy, item } = await render()

    expect(spy).toHaveBeenCalledWith(item.id, todayIso())
    expect(wrapper.find('h1').text()).toBe('Streamflix')
    expect(wrapper.find('header').text()).toContain('Streamflix · Everyday checking')
    expect(find('show-status').text()).toBe('Active')
    expect(find('show-frequency').text()).toBe('Monthly')
    expect(wrapper.text()).not.toContain('Amount varies')
    expect(find('subscription-stats').exists()).toBe(true)
    expect(find('subscription-payments').exists()).toBe(true)
    expect(find('upcoming-payments').exists()).toBe(true)
    expect(find('subscription-details').exists()).toBe(true)
    expect(find('subscription-related').exists()).toBe(true)
    // Where it is: the Subscriptions tab, then this one, with a way back to the tab.
    expect(find('show-breadcrumbs').element.tagName).toBe('NAV')
    const crumbs = wrapper.findAll('.v-breadcrumbs-item')
    expect(crumbs.map((item) => item.text())).toEqual(['Subscriptions', 'Streamflix'])
    expect(crumbs[0]!.find('a').attributes('href')).toBe('/subscriptions')
    expect(document.title).toBe('Streamflix · Subscription · Cashcove')
  })

  it('gives a phone the way back to the tab instead of the whole trail', async () => {
    vi.spyOn(billsApi, 'fetchBillOverview').mockResolvedValue(makeOverview(makeBill()))
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
    vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([])
    vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([])
    const { wrapper } = await mountWithPlugins(SubscriptionView, {
      width: 400,
      props: { kind: 'bill', id: 'bill-power' },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    const back = wrapper.find('[data-test="breadcrumb-back"]')
    expect(back.text()).toBe('Bills')
    expect(back.attributes('aria-label')).toBe('Back to Bills')
    expect(back.attributes('href')).toBe('/bills')
    expect(wrapper.find('.v-breadcrumbs').exists()).toBe(false)
  })

  it('is a bill’s page in the same way, in a bill’s words', async () => {
    const { wrapper, spy, item } = await render({ kind: 'bill' })

    expect(spy).toHaveBeenCalledWith(item.id, todayIso())
    expect(wrapper.find('h1').text()).toBe('City Power')
    expect(wrapper.text()).toContain('Amount varies')
    const crumbs = wrapper.findAll('.v-breadcrumbs-item')
    expect(crumbs.map((item) => item.text())).toEqual(['Bills', 'City Power'])
    expect(crumbs[0]!.find('a').attributes('href')).toBe('/bills')
    expect(wrapper.find('.page-header__icon svg').classes()).toContain('lucide-receipt-text')
    expect(document.title).toBe('City Power · Bill · Cashcove')
  })

  it('names an account that is not there as unavailable', async () => {
    const { wrapper } = await render({ changes: { account_id: 'account-gone' } })

    expect(wrapper.find('header').text()).toContain('Streamflix · Account unavailable')
  })

  it('shows a skeleton until it has loaded', async () => {
    vi.spyOn(subscriptionsApi, 'fetchSubscriptionOverview').mockReturnValue(new Promise(() => {}))
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { wrapper } = await mountWithPlugins(SubscriptionView, {
      width: 1280,
      props: { kind: 'subscription', id: 'subscription-streamflix' },
      beforeMount: () => seedFinance(),
    })
    await flushPromises()

    expect(wrapper.find('[data-test="show-loading"]').exists()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('[data-test="show-missing"]').exists()).toBe(false)
    // It already says where it is, calling it what it is until it knows its name.
    expect(wrapper.findAll('.v-breadcrumbs-item').map((item) => item.text())).toEqual([
      'Subscriptions',
      'Subscription',
    ])
  })

  it.each([404, 422])(
    'says it is not there when the API says %i, with the way back',
    async (status) => {
      const { wrapper, find } = await render({
        overview: new ApiError(status, 'That subscription doesn’t exist anymore.'),
      })

      expect(find('show-missing').text()).toContain('That subscription doesn’t exist anymore')
      expect(find('show-missing').find('a').attributes('href')).toBe('/subscriptions')
      expect(wrapper.findAll('.v-breadcrumbs-item').map((item) => item.text())).toEqual([
        'Subscriptions',
        'Not found',
      ])
      expect(wrapper.find('h1').exists()).toBe(false)
      expect(find('show-error').exists()).toBe(false)
    },
  )

  it('says what went wrong for anything else, and tries again', async () => {
    const { find, spy, item } = await render({ overview: new Error('Temporary problem') })

    expect(find('show-error').text()).toContain('Temporary problem')
    expect(find('show-missing').exists()).toBe(false)

    spy.mockResolvedValue(makeOverview(makeSubscription({ next_due_date: inDays(20) })))
    await find('show-retry').trigger('click')
    await flushPromises()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(find('show-error').exists()).toBe(false)
    expect(find('subscription-details').exists()).toBe(true)
    expect(item.name).toBe('Streamflix')
  })

  it('keeps what it showed when loading it afresh fails, and says so', async () => {
    const { wrapper, find, spy, component } = await render()
    spy.mockRejectedValue(new Error('No connection'))

    component('SubscriptionPaymentsDialog').vm.$emit('changed')
    await flushPromises()

    expect(find('show-error').text()).toContain('No connection')
    expect(wrapper.find('h1').text()).toBe('Streamflix')
  })

  it('tells a viewer what they can do, and leaves out everything that changes it', async () => {
    const { find, component, wrapper } = await render({
      role: 'viewer',
      changes: { next_due_date: inDays(-4), amount: '15.49', last_payment_amount: '17.99' },
    })

    expect(find('read-only-notice').text()).toBe(
      'You can see this subscription. Only an admin can change it.',
    )
    for (const name of ['show-edit', 'show-link-payments', 'show-actions', 'show-update-amount']) {
      expect(find(name).exists(), name).toBe(false)
    }
    expect(find('show-overdue-link').exists()).toBe(false)
    expect(find('show-overdue-edit').exists()).toBe(false)
    expect(component('SubscriptionDialog').exists()).toBe(false)
    expect(component('SubscriptionPaymentsDialog').exists()).toBe(false)
    // They are still told how it is doing.
    expect(find('show-overdue-alert').exists()).toBe(true)
    expect(find('show-price-change').exists()).toBe(true)
    expect(wrapper.find('[data-test="payment-unlink"]').exists()).toBe(false)
  })

  it('opens the dialog to change it, and loads it afresh once saved', async () => {
    const { find, component, spy } = await render()
    expect(component('SubscriptionDialog').props('modelValue')).toBe(false)

    await find('show-edit').trigger('click')
    expect(component('SubscriptionDialog').props('modelValue')).toBe(true)
    expect(component('SubscriptionDialog').props('subscription')).toMatchObject({
      name: 'Streamflix',
    })
    expect(component('SubscriptionDialog').props('kind')).toBe('subscription')

    component('SubscriptionDialog').vm.$emit('saved')
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)

    component('SubscriptionDialog').vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(component('SubscriptionDialog').props('modelValue')).toBe(false)
  })

  it('opens the dialog to link payments, from the header and from the empty list, and follows what it changes', async () => {
    const { find, component, spy } = await render()

    await find('show-link-payments').trigger('click')
    expect(component('SubscriptionPaymentsDialog').props('modelValue')).toBe(true)
    component('SubscriptionPaymentsDialog').vm.$emit('changed')
    await flushPromises()
    expect(spy).toHaveBeenCalledTimes(2)

    component('SubscriptionPaymentsDialog').vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(component('SubscriptionPaymentsDialog').props('modelValue')).toBe(false)
    component('SubscriptionPayments').vm.$emit('link')
    await flushPromises()
    expect(component('SubscriptionPaymentsDialog').props('modelValue')).toBe(true)
  })

  it('pauses it from the menu, and loads it afresh', async () => {
    const update = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockResolvedValue(makeSubscription({ active: false }))
    const { spy, item, choose } = await render()

    await choose('show-toggle')

    expect(update).toHaveBeenCalledWith(item.id, { active: false })
    expect(notices.value.at(-1)?.text).toBe('Paused automatic matching')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('says why pausing did not work', async () => {
    vi.spyOn(subscriptionsApi, 'updateSubscription').mockRejectedValue(new Error('No connection'))
    const { find, choose } = await render()

    await choose('show-toggle')

    expect(find('show-error').text()).toContain('No connection')
  })

  it('says it is paused, offers to resume from the menu and from what says so, and does not call it late', async () => {
    const update = vi.spyOn(billsApi, 'updateBill').mockResolvedValue(makeBill({ active: true }))
    const { find, choose, item } = await render({
      kind: 'bill',
      changes: { active: false, next_due_date: inDays(-6) },
    })

    expect(find('show-status').text()).toBe('Paused')
    expect(find('show-paused-alert').text()).toContain(
      'Paused. Cashcove isn’t linking new payments',
    )
    expect(find('show-overdue-alert').exists()).toBe(false)
    expect(find('show-due-alert').exists()).toBe(false)

    await find('show-resume').trigger('click')
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(item.id, { active: true })
    expect(notices.value.at(-1)?.text).toBe('Resumed automatic matching')

    await choose('show-toggle')
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('leaves a viewer with only the word that it is paused', async () => {
    const { find } = await render({ role: 'viewer', changes: { active: false } })

    expect(find('show-paused-alert').exists()).toBe(true)
    expect(find('show-resume').exists()).toBe(false)
  })

  it('goes back to the list once deleted, and stays when the person thinks better of it', async () => {
    const remove = vi.spyOn(subscriptionsApi, 'deleteSubscription').mockResolvedValue(undefined)
    const { router, choose, item } = await render()

    await choose('show-delete')
    expect(confirmRequest.value?.title).toBe('Delete Streamflix?')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()
    expect(router.currentRoute.value.path).toBe(`/subscriptions/${item.id}`)

    await choose('show-delete')
    await answer(true)
    await flushPromises()
    expect(remove).toHaveBeenCalledWith(item.id)
    // The list's own view is loaded on the way, which takes a moment.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('subscriptions')
    })
    expect(notices.value.at(-1)?.text).toBe('Deleted Streamflix')
  })

  it('warns of a payment that is overdue, and gives an admin the ways to put it right', async () => {
    const { find, component } = await render({ changes: { next_due_date: inDays(-2) } })

    expect(find('show-overdue-alert').text()).toContain(
      'Overdue by 2 days without a payment linked',
    )
    expect(find('show-due-alert').exists()).toBe(false)

    await find('show-overdue-link').trigger('click')
    expect(component('SubscriptionPaymentsDialog').props('modelValue')).toBe(true)
    await find('show-overdue-edit').trigger('click')
    expect(component('SubscriptionDialog').props('modelValue')).toBe(true)
  })

  it.each([
    [0, 'Due today'],
    [2, 'Due in 2 days'],
    [3, 'Due in 3 days'],
  ])('warns of one due in %i days, within the reminder window of 3', async (days, said) => {
    const { find } = await render({ changes: { next_due_date: inDays(days) } })

    expect(find('show-due-alert').text()).toBe(`${said}, within your 3-day reminder window.`)
    expect(find('show-overdue-alert').exists()).toBe(false)
  })

  it('says nothing of one due after the window, or when reminders are off', async () => {
    const { find } = await render({ changes: { next_due_date: inDays(4) } })
    expect(find('show-due-alert').exists()).toBe(false)

    const { find: off } = await render({ changes: { next_due_date: inDays(1) } })
    expect(off('show-due-alert').exists()).toBe(true)
  })

  it('reads the household’s reminder for what it is, and has defaults until it is loaded', async () => {
    const { find, component } = await render({
      kind: 'bill',
      withoutPreferences: true,
      changes: { next_due_date: inDays(1) },
    })

    // With no settings to go by, reminders are off for the moment.
    expect(find('show-due-alert').exists()).toBe(false)
    expect(component('SubscriptionDetails').props('reminder')).toEqual({ enabled: false, days: 5 })
  })

  it('notices a payment that was not the amount, and offers an admin the new one', async () => {
    const update = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockResolvedValue(makeSubscription())
    const { find, item, spy } = await render({
      changes: { amount: '15.49', last_payment_amount: '17.99' },
    })

    expect(find('show-price-change').text()).toContain('The last payment was $17.99, not $15.49.')
    await find('show-update-amount').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(item.id, { amount: '17.99' })
    expect(notices.value.at(-1)?.text).toBe('Updated Streamflix to $17.99')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('says nothing of the price when payments match, or when it changes every time', async () => {
    const { find } = await render()
    expect(find('show-price-change').exists()).toBe(false)

    const { find: bill } = await render({
      kind: 'bill',
      changes: { last_payment_amount: '140.01' },
    })
    expect(bill('show-price-change').exists()).toBe(false)
  })

  it('shows the one asked for when the address changes to another, not the last until it arrives', async () => {
    const { wrapper, spy } = await render()
    const other = makeSubscription({ id: 'subscription-other', name: 'Musicly' })
    let arrive!: (overview: RecurringOverview) => void
    spy.mockReturnValue(new Promise((resolve) => (arrive = resolve)))

    await wrapper.setProps({ id: other.id })
    await flushPromises()
    expect(spy).toHaveBeenLastCalledWith('subscription-other', todayIso())
    expect(wrapper.find('h1').exists()).toBe(false)
    expect(wrapper.find('[data-test="show-loading"]').exists()).toBe(true)

    arrive(makeOverview(other))
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Musicly')
    expect(document.title).toBe('Musicly · Subscription · Cashcove')
  })

  it('ignores an answer that arrives after a newer one was asked for, whether it worked or not', async () => {
    const answers: {
      resolve: (overview: RecurringOverview) => void
      reject: (error: Error) => void
    }[] = []
    vi.spyOn(subscriptionsApi, 'fetchSubscriptionOverview').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answers.push({ resolve, reject })
        }),
    )
    vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
    const { wrapper } = await mountWithPlugins(SubscriptionView, {
      width: 1280,
      props: { kind: 'subscription', id: 'one' },
      beforeMount: () => seedFinance(),
    })
    await wrapper.setProps({ id: 'two' })
    await wrapper.setProps({ id: 'three' })

    answers[0]!.reject(new ApiError(404, 'Gone'))
    answers[1]!.resolve(
      makeOverview(makeSubscription({ name: 'Second', next_due_date: inDays(20) })),
    )
    await flushPromises()
    expect(wrapper.find('[data-test="show-missing"]').exists()).toBe(false)
    expect(wrapper.find('h1').exists()).toBe(false)

    answers[2]!.resolve(
      makeOverview(makeSubscription({ name: 'Third', next_due_date: inDays(20) })),
    )
    await flushPromises()
    expect(wrapper.find('h1').text()).toBe('Third')
  })

  it('loads the household’s settings when nothing has yet, for the reminders and amounts', async () => {
    const { pinia } = await render({ withoutPreferences: true })
    const { usePreferencesStore } = await import('@/stores/preferences')

    expect(usePreferencesStore(pinia).load).toHaveBeenCalled()
  })
})
