import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as billsApi from '@/api/bills'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import type { Subscription } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import type { Transaction } from '@/api/transactions'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { checking, latte, makePage, makeTransaction, seedFinance, wholeFoods } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import SubscriptionPaymentsDialog from '@/views/subscriptions/SubscriptionPaymentsDialog.vue'

const subscription = makeSubscription()
const linked = makeTransaction({
  id: 'transaction-linked',
  payee: 'Streamflix',
  amount: '-14.99',
  subscription_id: subscription.id,
})
const elsewhere = makeTransaction({
  id: 'transaction-elsewhere',
  payee: 'Hulu',
  amount: '-9.99',
  subscription_id: 'subscription-hulu',
})
const free = makeTransaction({ id: 'transaction-free', payee: 'Zelle to Sam', amount: '-20.00' })
const bill = makeBill()
const billPayment = makeTransaction({
  id: 'transaction-bill',
  payee: 'City Power',
  amount: '-96.40',
  subscription_id: bill.id,
})

async function render(props: { subscription?: Subscription | null; items?: Transaction[] } = {}) {
  const open = ref(false)
  const changed = vi.fn()
  const current = ref<Subscription | null>(
    'subscription' in props ? (props.subscription ?? null) : subscription,
  )
  const Host = defineComponent({
    render: () =>
      h(SubscriptionPaymentsDialog, {
        subscription: current.value,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onChanged: changed,
      }),
  })
  const fetch = vi
    .spyOn(transactionsApi, 'fetchTransactions')
    .mockResolvedValue(makePage(props.items ?? [linked, elsewhere, free]))
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([
    subscription,
    makeSubscription({ id: 'subscription-hulu', name: 'Hulu' }),
  ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([bill])
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const find = (name: string) => overlay().find(`[data-test="${name}"]`)
  return { ...mounted, open, current, changed, fetch, overlay, find }
}

describe('SubscriptionPaymentsDialog', () => {
  it('lists payments from any account, with ways to link each', async () => {
    const { overlay, find, fetch } = await render()

    expect(overlay().find('h2').text()).toBe('Link payments to Streamflix')
    expect(find('payments-summary').text()).toBe(
      '2 payments linked. Next payment due Oct 15, 2026.',
    )
    expect(fetch).toHaveBeenCalledWith({ direction: 'out', page_size: 25, sort: '-date' })
    expect(find('payment-unlink-transaction-linked').text()).toBe('Linked')
    expect(find('payment-link-transaction-free').text()).toBe('Link')
    expect(find('payment-link-transaction-elsewhere').text()).toBe('Move here')
    expect(overlay().text()).toContain('Linked to Hulu')
  })

  it('says another subscription when the one a payment is linked to is not known', async () => {
    const { overlay } = await render({
      items: [
        makeTransaction({ id: 't-other', payee: 'Mystery', subscription_id: 'subscription-gone' }),
      ],
    })

    expect(overlay().text()).toContain('Linked to another subscription')
  })

  it('links a payment, then lists them afresh', async () => {
    const updated = { ...subscription, payment_count: 3 }
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 1, subscription: updated })
    const { find, changed, fetch } = await render()

    await find('payment-link-transaction-free').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith(subscription.id, ['transaction-free'])
    expect(notices.value.at(-1)?.text).toBe('Linked Zelle to Sam to Streamflix')
    expect(changed).toHaveBeenCalledWith(updated)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('payments-summary').text()).toContain('3 payments linked.')
  })

  it('moves a payment from another subscription', async () => {
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 1, subscription })
    const { find } = await render()

    await find('payment-link-transaction-elsewhere').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith(subscription.id, ['transaction-elsewhere'])
    expect(notices.value.at(-1)?.text).toBe('Linked Hulu to Streamflix')
  })

  it('takes a payment off the subscription', async () => {
    const updated = { ...subscription, payment_count: 1 }
    const unlink = vi
      .spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
      .mockResolvedValue(updated)
    const { find, changed } = await render()

    await find('payment-unlink-transaction-linked').trigger('click')
    await flushPromises()

    expect(unlink).toHaveBeenCalledWith(subscription.id, 'transaction-linked')
    expect(notices.value.at(-1)?.text).toBe('Unlinked Streamflix from Streamflix')
    expect(changed).toHaveBeenCalledWith(updated)
    expect(find('payments-summary').text()).toContain('1 payment linked.')
  })

  it('says why a payment could not be linked, and changes nothing', async () => {
    vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments').mockRejectedValue(
      new ApiError(0, "Can't reach Cashcove."),
    )
    const { find, changed, fetch } = await render()

    await find('payment-link-transaction-free').trigger('click')
    await flushPromises()

    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't update the payment. Can't reach Cashcove.",
      tone: 'error',
    })
    expect(changed).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(find('payment-link-transaction-free').attributes('disabled')).toBeUndefined()
  })

  it('lists only what is linked here when asked, and all again after reopening', async () => {
    const { find, fetch, open } = await render()

    await find('payments-scope').findAll('button').at(1)!.trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({
      direction: 'out',
      subscription_id: subscription.id,
      page_size: 25,
      sort: '-date',
    })

    open.value = false
    await flushPromises()
    open.value = true
    await flushPromises()
    expect(fetch).toHaveBeenLastCalledWith({ direction: 'out', page_size: 25, sort: '-date' })
  })

  it('follows the subscription as the page reloads it', async () => {
    const { find, current } = await render()

    current.value = { ...subscription, name: 'Streamflix Plus', payment_count: 7 }
    await flushPromises()

    expect(find('payments-summary').text()).toContain('7 payments linked.')
  })

  it('shows nothing to link until it is given a subscription, and closes from Done', async () => {
    const { overlay, find, open, fetch } = await render({ subscription: null })

    expect(overlay().find('h2').text()).toBe('Link payments to a subscription')
    expect(find('payments-scope').exists()).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    await find('payments-done').trigger('click')
    expect(open.value).toBe(false)
  })

  it('ignores a click when it has no subscription, even from a stale row', async () => {
    const { find, current } = await render()
    const row = find('payment-link-transaction-free')
    current.value = null
    await flushPromises()

    await row.trigger('click')

    expect(notices.value).toEqual([])
  })

  describe('for a bill', () => {
    it('is about the bill, and links payments through the bills API', async () => {
      const updated = { ...bill, payment_count: 2 }
      const link = vi
        .spyOn(billsApi, 'linkBillPayments')
        .mockResolvedValue({ count: 1, subscription: updated })
      const unlink = vi.spyOn(billsApi, 'unlinkBillPayment').mockResolvedValue(bill)
      const linkSubscription = vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      const { overlay, find, changed } = await render({
        subscription: bill,
        items: [billPayment, elsewhere, free],
      })

      expect(overlay().find('h2').text()).toBe('Link payments to City Power')
      expect(overlay().text()).toContain(
        'Linked payments count toward the bill, take its category and settle its next due date.',
      )
      expect(page().find('[data-test="bill-payments-dialog"]').exists()).toBe(true)
      expect(page().find('[data-test="subscription-payments-dialog"]').exists()).toBe(false)

      await find('payment-link-transaction-free').trigger('click')
      await flushPromises()
      expect(link).toHaveBeenCalledWith('bill-power', ['transaction-free'])
      expect(notices.value.at(-1)?.text).toBe('Linked Zelle to Sam to City Power')
      expect(changed).toHaveBeenCalledWith(updated)

      await find('payment-unlink-transaction-bill').trigger('click')
      await flushPromises()
      expect(unlink).toHaveBeenCalledWith('bill-power', 'transaction-bill')
      expect(notices.value.at(-1)?.text).toBe('Unlinked City Power from City Power')
      expect(linkSubscription).not.toHaveBeenCalled()
    })

    it('names the subscription a payment moves from, since bills share the list', async () => {
      const { overlay } = await render({ subscription: bill, items: [elsewhere] })

      expect(overlay().text()).toContain('Linked to Hulu')
    })
  })

  it('closes from the dialog’s own close button', async () => {
    const { open } = await render()

    await page().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
  })

  it('uses the household currency for amounts', async () => {
    const { overlay } = await render()
    expect(overlay().text()).toContain('-$14.99')
    expect([checking.currency, wholeFoods.payee, latte.payee]).toEqual([
      'USD',
      'Whole Foods',
      'Blue Bottle',
    ])
  })
})
