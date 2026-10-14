import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as billsApi from '@/api/bills'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import type { Subscription } from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import type { Transaction } from '@/api/transactions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { answer } from '@/test/confirm'
import { page } from '@/test/dom'
import { checking, makeAccount, makePage, makeTransaction, seedFinance } from '@/test/finance'
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
const canadian = makeAccount({ id: 'account-cad', name: 'Canadian chequing', currency: 'CAD' })

interface Options {
  subscription?: Subscription | null
  /** What is left to link, and what is linked here, as the API lists them. */
  candidates?: Transaction[]
  here?: Transaction[]
}

async function render(options: Options = {}) {
  const open = ref(false)
  const changed = vi.fn()
  const current = ref<Subscription | null>(
    'subscription' in options ? (options.subscription ?? null) : subscription,
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
  // What is linked here is its own list, and the rest is what is left to find.
  const fetch = vi
    .spyOn(transactionsApi, 'fetchTransactions')
    .mockImplementation((query = {}) =>
      Promise.resolve(
        makePage(
          query.subscription_id
            ? (options.here ?? [linked])
            : (options.candidates ?? [elsewhere, free]),
        ),
      ),
    )
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([
    subscription,
    makeSubscription({ id: 'subscription-hulu', name: 'Hulu' }),
  ])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([bill])
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ accounts: [checking, canadian] }),
  })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const find = (name: string) => overlay().find(`[data-test="${name}"]`)
  /** Ticks or unticks a payment's row, as pressing it does. */
  const press = async (id: string) => {
    const box = find(`payment-select-${id}`).find('input')
    await box.setValue(!(box.element as HTMLInputElement).checked)
    await flushPromises()
  }
  const scopeTo = async (index: number) => {
    await find('payments-scope').findAll('button').at(index)!.trigger('click')
    await flushPromises()
  }
  return { ...mounted, open, current, changed, fetch, overlay, find, press, scopeTo }
}

describe('SubscriptionPaymentsDialog', () => {
  it('starts with the payments that look like it, and not what is linked already', async () => {
    const { overlay, find, fetch } = await render()

    expect(overlay().find('h2').text()).toBe('Link payments to Streamflix')
    expect(find('payments-summary').text()).toBe(
      '2 payments linked. Next payment due Oct 15, 2026.',
    )
    expect(fetch).toHaveBeenCalledWith({
      direction: 'out',
      q: 'Streamflix',
      not_subscription_id: subscription.id,
      page_size: 25,
      sort: '-date',
    })
    expect(find('payments-scope').text()).toBe('Find paymentsLinked here')
    expect(find('payments-hint').text()).toContain('payments that look like “Streamflix”')
    // As paid, so with no minus, and with where it was and what it is linked to already.
    const rows = overlay().findAll('[data-test="payment-row"]')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Hulu')
    expect(rows[0]!.text()).toContain('$9.99')
    expect(rows[0]!.text()).not.toContain('-$9.99')
    expect(rows[0]!.text()).toContain('Sep 18 · Everyday checking · Groceries')
    expect(find('payment-elsewhere').text()).toBe('Linked to Hulu · moves here')
    expect(rows[1]!.find('[data-test="payment-elsewhere"]').exists()).toBe(false)
    expect(find('payments-picked').exists()).toBe(false)
    expect(find('payments-link-selected').exists()).toBe(false)
  })

  it('says another subscription when the one a payment is linked to is not known', async () => {
    const { overlay } = await render({
      candidates: [
        makeTransaction({ id: 't-other', payee: 'Mystery', subscription_id: 'subscription-gone' }),
      ],
    })

    expect(overlay().text()).toContain('Linked to another subscription or bill · moves here')
  })

  it('adds up what is chosen as payments are ticked, and lets them be cleared', async () => {
    const { find, press } = await render()

    await press('transaction-free')
    expect(find('payments-picked').text()).toBe('1 payment chosen · $20.00')
    expect(find('payments-link-selected').text()).toBe('Link payment')
    expect(find('payment-select-transaction-free').find('input').element).toHaveProperty(
      'checked',
      true,
    )

    await press('transaction-elsewhere')
    expect(find('payments-picked').text()).toBe('2 payments chosen · $29.99')
    expect(find('payments-link-selected').text()).toBe('Link 2 payments')

    // Ticking one again takes it off.
    await press('transaction-free')
    expect(find('payments-picked').text()).toBe('1 payment chosen · $9.99')

    await find('payments-clear-picked').trigger('click')
    expect(find('payments-picked').exists()).toBe(false)
    expect(find('payments-link-selected').exists()).toBe(false)
  })

  it('leaves out a total that would add one currency to another', async () => {
    const foreign = makeTransaction({
      id: 'transaction-foreign',
      payee: 'Tim Hortons',
      amount: '-6.00',
      account_id: canadian.id,
    })
    const { find, overlay, press } = await render({ candidates: [free, foreign] })

    expect(overlay().text()).toContain('CA$6.00')
    await press('transaction-foreign')
    expect(find('payments-picked').text()).toBe('1 payment chosen · CA$6.00')
    await press('transaction-free')
    expect(find('payments-picked').text()).toBe('2 payments chosen')
  })

  it('links one payment, lists what is left afresh, and says so', async () => {
    const updated = { ...subscription, payment_count: 3 }
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 1, subscription: updated })
    const { find, changed, fetch, press } = await render()

    await press('transaction-free')
    await find('payments-link-selected').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith(subscription.id, ['transaction-free'])
    expect(notices.value.at(-1)?.text).toBe('Linked Zelle to Sam to Streamflix')
    expect(changed).toHaveBeenCalledWith(updated)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('payments-summary').text()).toContain('3 payments linked.')
    // Nothing is left chosen.
    expect(find('payments-picked').exists()).toBe(false)
  })

  it('links several together, moving ones that were another’s, and says how many', async () => {
    const updated = { ...subscription, payment_count: 4 }
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 2, subscription: updated })
    const { find, press } = await render()

    await press('transaction-elsewhere')
    await press('transaction-free')
    await find('payments-link-selected').trigger('click')
    await flushPromises()

    expect(link).toHaveBeenCalledWith(subscription.id, [
      'transaction-elsewhere',
      'transaction-free',
    ])
    expect(notices.value.at(-1)?.text).toBe('Linked 2 payments to Streamflix')
  })

  it('says why the payments could not be linked, keeps them chosen and changes nothing', async () => {
    vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments').mockRejectedValue(
      new ApiError(0, "Can't reach Cashcove."),
    )
    const { find, changed, fetch, press } = await render()

    await press('transaction-free')
    await find('payments-link-selected').trigger('click')
    await flushPromises()

    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't link the payments. Can't reach Cashcove.",
      tone: 'error',
    })
    expect(changed).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(1)
    // Still chosen, and free to try again.
    expect(find('payments-picked').text()).toBe('1 payment chosen · $20.00')
    expect(find('payments-link-selected').attributes('disabled')).toBeUndefined()
  })

  it('cannot be closed or changed while the payments are being linked', async () => {
    let finish!: (value: { count: number; subscription: Subscription }) => void
    vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments').mockReturnValue(
      new Promise((resolve) => (finish = resolve)),
    )
    const { find, press, open } = await render()

    await press('transaction-free')
    await find('payments-link-selected').trigger('click')
    await flushPromises()

    expect(find('payments-done').attributes('disabled')).toBeDefined()
    expect(find('payments-clear-picked').attributes('disabled')).toBeDefined()
    expect(
      find('payment-select-transaction-free').find('input').attributes('disabled'),
    ).toBeDefined()
    expect(find('dialog-close').attributes('disabled')).toBeDefined()
    expect(open.value).toBe(true)

    finish({ count: 1, subscription })
    await flushPromises()
    expect(find('payments-done').attributes('disabled')).toBeUndefined()
  })

  it('shows every payment not linked here once the search is cleared, and is not “looks like” any more', async () => {
    const { find, fetch } = await render()

    await find('finder-search').find('input').setValue('')
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith({
        direction: 'out',
        not_subscription_id: subscription.id,
        page_size: 25,
        sort: '-date',
      })
    })
    expect(find('payments-hint').exists()).toBe(false)
  })

  it('offers to show every payment when nothing looks like it, and does', async () => {
    const { find, fetch, overlay } = await render({ candidates: [] })

    expect(overlay().text()).toContain('No payments found')
    await find('payments-clear').trigger('click')
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith(expect.not.objectContaining({ q: expect.anything() }))
    })
  })

  it('has no way to show every payment when it was not searching for anything', async () => {
    const { find } = await render({ candidates: [] })
    await find('finder-search').find('input').setValue('')
    await vi.waitFor(() => {
      expect(find('payments-clear').exists()).toBe(false)
    })
  })

  describe('what is linked here', () => {
    it('lists it on its own, with a way to take each off', async () => {
      const { find, fetch, scopeTo, overlay } = await render()

      await scopeTo(1)

      expect(fetch).toHaveBeenLastCalledWith({
        direction: 'out',
        subscription_id: subscription.id,
        page_size: 25,
        sort: '-date',
      })
      // Nothing to search for until it is asked, and nothing to choose.
      expect(find('finder-search').find('input').element).toHaveProperty('value', '')
      expect(find('payments-hint').exists()).toBe(false)
      expect(find('payment-unlink-transaction-linked').text()).toBe('Unlink')
      expect(find('payment-unlink-transaction-linked').attributes('aria-label')).toBe(
        'Unlink Streamflix on Sep 18, 2026',
      )
      expect(overlay().find('input[type="checkbox"]').exists()).toBe(false)
      expect(find('payments-picked').exists()).toBe(false)
    })

    it('takes a payment off once the person has confirmed it', async () => {
      const updated = { ...subscription, payment_count: 1 }
      const unlink = vi
        .spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
        .mockResolvedValue(updated)
      const { find, changed, scopeTo, fetch } = await render()
      await scopeTo(1)

      await find('payment-unlink-transaction-linked').trigger('click')
      await flushPromises()
      // Nothing has come off yet: it asks first, in the error tone.
      expect(unlink).not.toHaveBeenCalled()
      expect(confirmRequest.value).toMatchObject({
        title: 'Unlink Streamflix?',
        confirmText: 'Unlink payment',
        tone: 'error',
      })
      await answer(true)

      expect(unlink).toHaveBeenCalledWith(subscription.id, 'transaction-linked')
      expect(notices.value.at(-1)?.text).toBe('Unlinked Streamflix from Streamflix')
      expect(changed).toHaveBeenCalledWith(updated)
      expect(find('payments-summary').text()).toContain('1 payment linked.')
      // And what is listed is loaded afresh.
      expect(fetch).toHaveBeenCalledTimes(3)
    })

    it('leaves a payment linked when the person thinks better of unlinking it', async () => {
      const unlink = vi.spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
      const { find, changed, fetch, scopeTo } = await render()
      await scopeTo(1)

      await find('payment-unlink-transaction-linked').trigger('click')
      await flushPromises()
      await answer(false)

      expect(unlink).not.toHaveBeenCalled()
      expect(changed).not.toHaveBeenCalled()
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(notices.value).toEqual([])
      // Free to ask again, since nothing is left waiting.
      expect(find('payment-unlink-transaction-linked').attributes('disabled')).toBeUndefined()
    })

    it('says nothing is linked yet, and goes to finding some', async () => {
      const { find, scopeTo, overlay, fetch } = await render({ here: [] })
      await scopeTo(1)

      expect(overlay().text()).toContain('Nothing is linked yet')
      await find('payments-find').trigger('click')
      await flushPromises()

      expect(find('payments-scope').find('.v-btn--active').text()).toBe('Find payments')
      expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Streamflix' }))
    })

    it('keeps what was chosen while looking at it, and hides the bar until finding again', async () => {
      const { find, press, scopeTo } = await render()
      await press('transaction-free')

      await scopeTo(1)
      expect(find('payments-link-selected').exists()).toBe(false)
      expect(find('payments-done').exists()).toBe(true)

      await scopeTo(0)
      expect(find('payments-picked').text()).toBe('1 payment chosen · $20.00')
    })
  })

  it('starts afresh each time it is opened: finding, what looks like it, nothing chosen', async () => {
    const { find, fetch, open, press, scopeTo } = await render()
    await press('transaction-free')
    await scopeTo(1)

    open.value = false
    await flushPromises()
    open.value = true
    await flushPromises()

    expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'Streamflix' }))
    expect(find('payments-scope').find('.v-btn--active').text()).toBe('Find payments')
    expect(find('payments-picked').exists()).toBe(false)
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

  describe('for a bill', () => {
    it('is about the bill, and links and unlinks payments through the bills API', async () => {
      const updated = { ...bill, payment_count: 2 }
      const link = vi
        .spyOn(billsApi, 'linkBillPayments')
        .mockResolvedValue({ count: 1, subscription: updated })
      const unlink = vi.spyOn(billsApi, 'unlinkBillPayment').mockResolvedValue(bill)
      const linkSubscription = vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      const { overlay, find, changed, press, scopeTo, fetch } = await render({
        subscription: bill,
        candidates: [elsewhere, free],
        here: [billPayment],
      })

      expect(overlay().find('h2').text()).toBe('Link payments to City Power')
      expect(overlay().text()).toContain(
        'Linked payments count toward the bill, take its category and settle its next due date.',
      )
      expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ q: 'City Power & Light' }))
      expect(page().find('[data-test="bill-payments-dialog"]').exists()).toBe(true)
      expect(page().find('[data-test="subscription-payments-dialog"]').exists()).toBe(false)

      await press('transaction-free')
      await find('payments-link-selected').trigger('click')
      await flushPromises()
      expect(link).toHaveBeenCalledWith('bill-power', ['transaction-free'])
      expect(notices.value.at(-1)?.text).toBe('Linked Zelle to Sam to City Power')
      expect(changed).toHaveBeenCalledWith(updated)

      await scopeTo(1)
      await find('payment-unlink-transaction-bill').trigger('click')
      await flushPromises()
      await answer(true)
      expect(unlink).toHaveBeenCalledWith('bill-power', 'transaction-bill')
      expect(notices.value.at(-1)?.text).toBe('Unlinked City Power from City Power')
      expect(linkSubscription).not.toHaveBeenCalled()
    })

    it('names the subscription a payment moves from, since bills share the list', async () => {
      const { overlay } = await render({ subscription: bill, candidates: [elsewhere] })

      expect(overlay().text()).toContain('Linked to Hulu · moves here')
    })
  })

  it('closes from the dialog’s own close button', async () => {
    const { open } = await render()

    await page().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
  })
})
