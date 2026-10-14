import { flushPromises, type VueWrapper } from '@vue/test-utils'

import * as billsApi from '@/api/bills'
import * as subscriptionsApi from '@/api/subscriptions'
import type { PaymentPoint, PaymentSummary, Subscription } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import type { Transaction, TransactionPage } from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { page } from '@/test/dom'
import { checking, makePage, makeTransaction, seedFinance, visa } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import SubscriptionPayments from '@/views/subscriptions/SubscriptionPayments.vue'

const summary: PaymentSummary = {
  total: '44.97',
  average: '14.99',
  highest: '14.99',
  lowest: '14.99',
  first_on: '2026-07-15',
  this_year: '44.97',
}
const history: PaymentPoint[] = [
  { on: '2026-07-15', amount: '14.99' },
  { on: '2026-08-15', amount: '14.99' },
  { on: '2026-09-15', amount: '14.99' },
]

function payment(id: string, changes: Partial<Transaction> = {}): Transaction {
  return makeTransaction({
    id,
    payee: 'Streamflix',
    amount: '-14.99',
    date: '2026-09-15',
    subscription_id: 'subscription-streamflix',
    ...changes,
  })
}

const pageOf = (items: Transaction[], total = items.length): TransactionPage =>
  makePage(items, { total })

interface Options {
  subscription?: Subscription
  summary?: PaymentSummary
  history?: PaymentPoint[]
  readonly?: boolean
  items?: Transaction[]
  total?: number
  /** The first request fails, as one does when the connection drops. */
  failFirst?: boolean
}

async function render({
  subscription = makeSubscription(),
  readonly = false,
  items = [
    payment('t3'),
    payment('t2', { date: '2026-08-15' }),
    payment('t1', { date: '2026-07-15' }),
  ],
  total = items.length,
  failFirst = false,
  ...rest
}: Options = {}) {
  const fetch = vi
    .spyOn(transactionsApi, 'fetchTransactions')
    .mockResolvedValue(pageOf(items, total))
  if (failFirst) fetch.mockRejectedValueOnce(new Error('Temporary problem'))
  // The details of a payment name what it is linked to, from both kinds.
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([subscription])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([])
  const mounted = await mountWithPlugins(SubscriptionPayments, {
    props: {
      subscription,
      summary: rest.summary ?? summary,
      history: rest.history ?? history,
      readonly,
      refresh: 1,
    },
    beforeMount: () => seedFinance({ accounts: [checking, visa] }),
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const findAll = (name: string) => wrapper.findAll(`[data-test="${name}"]`)
  return { ...mounted, fetch, find, findAll }
}

/** Opens a payment's menu and presses one of its items, as a person would. */
async function choose(
  wrapper: VueWrapper,
  index: number,
  item: 'payment-details' | 'payment-unlink',
) {
  await wrapper.findAll('[data-test="payment-actions"]')[index]!.trigger('click')
  await flushPromises()
  await page().find(`[data-test="${item}"]`).trigger('click')
  await flushPromises()
}

describe('SubscriptionPayments', () => {
  it('lists the latest payments, newest first, as what was paid', async () => {
    const { find, findAll, fetch } = await render()

    expect(fetch).toHaveBeenCalledWith({
      subscription_id: 'subscription-streamflix',
      sort: '-date',
      page: 1,
      page_size: 10,
    })
    expect(find('subscription-payments').text()).toContain('3 payments')
    const rows = findAll('payment-item')
    expect(rows).toHaveLength(3)
    expect(rows[0]!.text()).toContain('Streamflix')
    expect(rows[0]!.text()).toContain('Sep 15, 2026 · Everyday checking')
    // The money went out, but what it came to is what was paid.
    expect(rows[0]!.text()).toContain('$14.99')
    expect(rows[0]!.text()).not.toContain('-$14.99')
    expect(find('payments-more').exists()).toBe(false)
    expect(find('payments-view-all').attributes('href')).toBe(
      '/transactions?subscription=subscription-streamflix',
    )
  })

  it('marks a payment the bank has not settled, and names an account it is not paid from', async () => {
    const { findAll } = await render({
      items: [
        payment('t2', { pending: true }),
        payment('t1', { account_id: visa.id }),
        payment('t0', { account_id: 'account-gone' }),
      ],
    })

    const rows = findAll('payment-item')
    expect(rows[0]!.text()).toContain('Pending')
    expect(rows[1]!.text()).not.toContain('Pending')
    expect(rows[1]!.text()).toContain('Rewards Visa')
    expect(rows[2]!.text()).toContain('Account unavailable')
  })

  it('adds up what it has cost, and leaves out what it has no figure for', async () => {
    const { findAll } = await render({ summary: { ...summary, average: null, lowest: null } })

    const figures = findAll('payment-figures')[0]!
    expect(figures.findAll('dt').map((item) => item.text())).toEqual(['This year', 'Highest'])
    expect(figures.findAll('dd').map((item) => item.text())).toEqual(['$44.97', '$14.99'])
  })

  it('draws what each payment cost once there are two to compare, and not before', async () => {
    const { wrapper } = await render()
    expect(wrapper.find('[data-test="payment-chart"]').exists()).toBe(true)

    const { wrapper: one } = await render({ history: history.slice(0, 1) })
    expect(one.find('[data-test="payment-chart"]').exists()).toBe(false)
  })

  it('invites an admin to link the first payment, when there are none', async () => {
    const { find, wrapper } = await render({
      subscription: makeSubscription({ payment_count: 0 }),
      items: [],
    })

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('No payments yet')
    expect(wrapper.text()).toContain('Payments to Streamflix from this account are linked')
    expect(find('payment-figures').exists()).toBe(false)
    expect(wrapper.find('[data-test="payment-chart"]').exists()).toBe(false)
    await find('payments-link-first').trigger('click')
    expect(wrapper.emitted('link')).toHaveLength(1)
  })

  it('leaves linking to admins', async () => {
    const { find } = await render({
      subscription: makeSubscription({ payment_count: 0 }),
      items: [],
      readonly: true,
    })

    expect(find('payments-link-first').exists()).toBe(false)
  })

  it('shows the older payments a page at a time', async () => {
    const newest = Array.from({ length: 10 }, (_, index) => payment(`t${index}`))
    const { find, findAll, fetch } = await render({ items: newest, total: 14 })
    expect(findAll('payment-item')).toHaveLength(10)

    fetch.mockResolvedValue(
      pageOf([payment('t10'), payment('t11'), payment('t12'), payment('t13')], 14),
    )
    await find('payments-more').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenLastCalledWith({
      subscription_id: 'subscription-streamflix',
      sort: '-date',
      page: 2,
      page_size: 10,
    })
    expect(findAll('payment-item')).toHaveLength(14)
    expect(find('payments-more').exists()).toBe(false)
  })

  it('says what went wrong loading them, and tries again', async () => {
    const { find, findAll, fetch } = await render({ failFirst: true })

    expect(find('payments-error').text()).toContain('Temporary problem')
    expect(findAll('payment-item')).toHaveLength(0)

    await find('payments-retry').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('payments-error').exists()).toBe(false)
    expect(findAll('payment-item')).toHaveLength(3)
  })

  it('starts again at the first page whenever the page has loaded it afresh', async () => {
    const { wrapper, fetch, findAll } = await render()
    expect(fetch).toHaveBeenCalledTimes(1)

    fetch.mockResolvedValue(pageOf([payment('t9')]))
    await wrapper.setProps({ refresh: 2 })
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(findAll('payment-item')).toHaveLength(1)

    await wrapper.setProps({ subscription: makeSubscription({ id: 'another' }) })
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ subscription_id: 'another' }))
  })

  it('ignores a page that arrives after a newer one was asked for, whether it worked or not', async () => {
    const answers: { resolve: (page: TransactionPage) => void; reject: (error: Error) => void }[] =
      []
    const fetch = vi.spyOn(transactionsApi, 'fetchTransactions').mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          answers.push({ resolve, reject })
        }),
    )
    const { wrapper } = await mountWithPlugins(SubscriptionPayments, {
      props: { subscription: makeSubscription(), summary, history, readonly: false, refresh: 1 },
      beforeMount: () => seedFinance({ accounts: [checking, visa] }),
    })
    await wrapper.setProps({ refresh: 2 })
    await wrapper.setProps({ refresh: 3 })
    expect(fetch).toHaveBeenCalledTimes(3)

    // The first of them failed after the second was asked for, and the second came in late.
    answers[0]!.reject(new Error('Too old to matter'))
    answers[1]!.resolve(pageOf([payment('stale')]))
    await flushPromises()
    expect(wrapper.find('[data-test="payments-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="payment-item"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="payments-loading"]').exists()).toBe(true)

    answers[2]!.resolve(pageOf([payment('fresh')]))
    await flushPromises()
    expect(wrapper.findAll('[data-test="payment-item"]')).toHaveLength(1)
    expect(wrapper.find('[data-test="payments-loading"]').exists()).toBe(false)
  })

  it('takes a payment off once the person has confirmed it, says so, and has the page load it afresh', async () => {
    const unlink = vi
      .spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
      .mockResolvedValue(makeSubscription())
    const { wrapper } = await render()

    await choose(wrapper, 1, 'payment-unlink')
    // It asks first, and says what keeps and what goes.
    expect(unlink).not.toHaveBeenCalled()
    expect(confirmRequest.value).toMatchObject({
      title: 'Unlink Streamflix?',
      confirmText: 'Unlink payment',
      tone: 'error',
    })
    expect(confirmRequest.value?.text).toContain('stays in your history with its category')
    await answer(true)

    expect(unlink).toHaveBeenCalledWith('subscription-streamflix', 't2')
    expect(notices.value.at(-1)?.text).toBe('Unlinked Streamflix from Streamflix')
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('leaves a payment linked when the person thinks better of it', async () => {
    const unlink = vi.spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
    const { wrapper } = await render()

    await choose(wrapper, 0, 'payment-unlink')
    await answer(false)

    expect(unlink).not.toHaveBeenCalled()
    expect(notices.value).toEqual([])
    expect(wrapper.emitted('changed')).toBeUndefined()
  })

  it('takes a payment off a bill through the bills API', async () => {
    const bill = makeBill()
    const unlink = vi.spyOn(billsApi, 'unlinkBillPayment').mockResolvedValue(bill)
    const { wrapper } = await render({
      subscription: bill,
      items: [payment('t1', { subscription_id: bill.id })],
    })

    await choose(wrapper, 0, 'payment-unlink')
    expect(confirmRequest.value?.text).toContain('no longer counts toward City Power')
    await answer(true)

    expect(unlink).toHaveBeenCalledWith('bill-power', 't1')
    expect(wrapper.emitted('changed')).toHaveLength(1)
    expect(wrapper.find('ul').attributes('aria-label')).toBe('Payments linked to this bill')
  })

  it('names each payment’s menu for it, and leaves them out for viewers', async () => {
    const { findAll } = await render()
    expect(findAll('payment-actions')[0]!.attributes('aria-label')).toBe(
      'Actions for Streamflix on Sep 15, 2026',
    )

    const { findAll: viewerRows } = await render({ readonly: true })
    expect(viewerRows('payment-actions')).toHaveLength(0)
    // They can still open a payment, from the row.
    expect(viewerRows('payment-open')).toHaveLength(3)
  })

  it('offers an admin to link payments from the card, and leaves it to admins', async () => {
    const { wrapper, find } = await render()
    await find('payments-link').trigger('click')
    expect(wrapper.emitted('link')).toHaveLength(1)

    const { find: viewer } = await render({ readonly: true })
    expect(viewer('payments-link').exists()).toBe(false)
  })

  it('opens a payment’s details from its menu as well as from its row', async () => {
    const { wrapper } = await render()

    await choose(wrapper, 1, 'payment-details')

    const dialog = page().find('[data-test="transaction-info-dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('Aug 15, 2026')
  })

  it('opens a payment to say all there is to know of it', async () => {
    const { wrapper, findAll } = await render({
      items: [
        payment('t1', { notes: 'Annual price rise', original_description: 'STREAMFLIX.COM 8665' }),
      ],
    })

    await findAll('payment-open')[0]!.trigger('click')
    await flushPromises()

    const dialog = page().find('[data-test="transaction-info-dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.text()).toContain('Streamflix')
    expect(dialog.find('[data-test="transaction-info-notes"]').text()).toBe('Annual price rise')

    // Closing it leaves the payments as they were.
    const close = dialog.findAll('button').find((button) => button.text() === 'Close')
    await close!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'TransactionInfoDialog' }).props('modelValue')).toBe(false)
  })
})
