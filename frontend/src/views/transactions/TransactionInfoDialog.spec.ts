import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import type { Subscription } from '@/api/subscriptions'
import * as subscriptionsApi from '@/api/subscriptions'
import type { Transaction } from '@/api/transactions'
import * as api from '@/api/transactions'
import { notices } from '@/composables/notify'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { page } from '@/test/dom'
import {
  coffee,
  groceries,
  latte,
  makeTransaction,
  salary,
  seedFinance,
  wholeFoods,
} from '@/test/finance'
import { checkingImport, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { makeSubscription } from '@/test/subscriptions'
import TransactionInfoDialog from '@/views/transactions/TransactionInfoDialog.vue'

const describedTransaction = { ...wholeFoods, original_description: 'WHOLE FOODS MARKET' }

async function render(
  editable = true,
  transaction: Transaction = describedTransaction,
  known: Subscription[] = [],
) {
  const open = ref(false)
  const saved = vi.fn()
  const edited = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(TransactionInfoDialog, {
        transaction,
        editable,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
        onEdit: edited,
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      seedImports()
      const store = useSubscriptionsStore()
      store.subscriptions = known
      store.loaded = known.length > 0
      // What loading them again, as opening a payment does, comes back with.
      if (!vi.isMockFunction(subscriptionsApi.fetchSubscriptions)) {
        vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue(known)
      }
    },
  })
  open.value = true
  await flushPromises()
  const subscriptionSelect = () =>
    wrapper
      .findAllComponents({ name: 'VSelect' })
      .find((select) => select.attributes('data-test') === 'transaction-info-subscription-select')
  return { open, saved, edited, wrapper, subscriptionSelect }
}

const dialog = () => document.querySelector('.v-overlay--active .app-dialog')!

describe('TransactionInfoDialog', () => {
  it('shows the transaction details and opens its separate edit form', async () => {
    const { edited, open, wrapper } = await render()
    expect(dialog().textContent).toContain('Whole Foods')
    expect(dialog().textContent).toContain('Everyday checking')
    expect(dialog().textContent).toContain('Original description')
    expect(wrapper.findComponent({ name: 'CategoryPicker' }).exists()).toBe(true)

    await page().find('[data-test="transaction-info-edit"]').trigger('click')
    expect(edited).toHaveBeenCalledWith(describedTransaction)
    wrapper.findComponent({ name: 'AppDialog' }).vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('saves a quick category change and reflects the saved transaction', async () => {
    const update = vi.spyOn(api, 'updateTransaction').mockResolvedValue({
      ...wholeFoods,
      category_id: coffee.id,
    })
    const { saved, wrapper } = await render()
    wrapper.findComponent({ name: 'CategoryPicker' }).vm.$emit('update:modelValue', coffee.id)
    await flushPromises()

    expect(update).toHaveBeenCalledWith(describedTransaction.id, { category_id: coffee.id })
    expect(saved).toHaveBeenCalledWith({ ...wholeFoods, category_id: coffee.id })
  })

  it('shows viewers details without category editing or an edit action', async () => {
    const update = vi.spyOn(api, 'updateTransaction')
    const { open, wrapper } = await render(false, wholeFoods)
    expect(wrapper.findComponent({ name: 'CategoryPicker' }).exists()).toBe(false)
    expect(page().find('[data-test="transaction-info-edit"]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'CategoryChip' }).props('categoryId')).toBe(groceries.id)
    expect(update).not.toHaveBeenCalled()

    await page().find('.v-card-actions button').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('shows bank source, pending status, and notes, even if its account was removed', async () => {
    const bankTransaction = {
      ...latte,
      account_id: 'account-deleted',
      original_description: latte.payee,
      notes: 'Morning coffee',
    }
    await render(true, bankTransaction)
    expect(dialog().textContent).toContain('From a bank through Plaid')
    expect(dialog().textContent).toContain('Pending')
    expect(dialog().textContent).toContain('Morning coffee')
    expect(dialog().textContent).not.toContain('Original description')
    expect(dialog().textContent).toContain('Deleted account')
  })

  it('shows a synced bank source and a matching original description only once', async () => {
    await render(true, { ...latte, original_description: latte.payee })
    expect(dialog().textContent).toContain('Synced from the bank through Plaid')
    expect(dialog().textContent).not.toContain('Original description')
  })

  it('shows the imported file and its original description', async () => {
    await render(
      true,
      makeTransaction({
        source: 'file',
        import_id: checkingImport.id,
        original_description: 'WHOLEFDS MKT #10234',
      }),
    )
    expect(dialog().textContent).toContain('Imported from a file')
    expect(dialog().textContent).toContain('harbor-checking.csv')
    expect(dialog().textContent).toContain('WHOLEFDS MKT #10234')
  })

  it('names the subscription a payment is linked to, loading them when they are not known yet', async () => {
    const fetch = vi
      .spyOn(subscriptionsApi, 'fetchSubscriptions')
      .mockResolvedValue([makeSubscription()])
    await render(true, makeTransaction({ subscription_id: 'subscription-streamflix' }))

    const row = dialog().querySelector('[data-test="transaction-info-subscription-select"]')
    expect(row?.textContent).toContain('Streamflix')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('does not load subscriptions it knows, and calls one it cannot name a subscription', async () => {
    const fetch = vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([])
    await render(false, makeTransaction({ subscription_id: 'subscription-streamflix' }), [
      makeSubscription(),
    ])
    expect(fetch).not.toHaveBeenCalled()
    expect(
      dialog().querySelector('[data-test="transaction-info-subscription"]')?.textContent,
    ).toContain('Streamflix')

    await render(false, makeTransaction({ subscription_id: 'subscription-gone' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain('A subscription')
  })

  it('loads the subscriptions an admin can choose from when opening a payment', async () => {
    const { subscriptionSelect } = await render(true, wholeFoods, [makeSubscription()])

    expect(subscriptionsApi.fetchSubscriptions).toHaveBeenCalledTimes(1)
    expect(subscriptionSelect()!.props('items')).toHaveLength(1)
  })

  it('does not load them for money coming in, or for a viewer who has nothing to name', async () => {
    await render(true, { ...salary, subscription_id: null })
    await render(false, wholeFoods)

    expect(subscriptionsApi.fetchSubscriptions).not.toHaveBeenCalled()
  })

  it('has no subscription row for a transaction that is not a subscription payment', async () => {
    await render()
    expect(dialog().querySelector('[data-test="transaction-info-subscription"]')).toBeNull()
  })

  it('lets an admin link a payment to a subscription, and shows what linking did', async () => {
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 1, subscription: makeSubscription() })
    const linked = makeTransaction({
      subscription_id: 'subscription-streamflix',
      category_id: coffee.id,
    })
    const fetchOne = vi.spyOn(api, 'fetchTransaction').mockResolvedValue(linked)
    const { saved, subscriptionSelect } = await render(true, wholeFoods, [makeSubscription()])
    expect(subscriptionSelect()!.props('items')).toEqual([
      {
        value: 'subscription-streamflix',
        title: 'Streamflix',
        props: { subtitle: 'Monthly · $14.99' },
      },
    ])

    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()

    expect(link).toHaveBeenCalledWith('subscription-streamflix', [wholeFoods.id])
    expect(fetchOne).toHaveBeenCalledWith(wholeFoods.id)
    expect(notices.value.at(-1)?.text).toBe('Linked it to Streamflix')
    // Linking can give it the subscription's category too, so what the API says is what's shown.
    expect(saved).toHaveBeenCalledWith(linked)
    expect(subscriptionSelect()!.props('modelValue')).toBe('subscription-streamflix')
  })

  it('names a subscription it cannot find, when linking to one', async () => {
    vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments').mockResolvedValue({
      count: 1,
      subscription: makeSubscription(),
    })
    vi.spyOn(api, 'fetchTransaction').mockResolvedValue(wholeFoods)
    const { subscriptionSelect } = await render(true, wholeFoods, [makeSubscription()])

    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-gone')
    await flushPromises()

    expect(notices.value.at(-1)?.text).toBe('Linked it to the subscription')
  })

  it('moves a payment to another subscription, and takes it off one', async () => {
    const power = makeSubscription({ id: 'subscription-power', name: 'Power' })
    const link = vi
      .spyOn(subscriptionsApi, 'linkSubscriptionPayments')
      .mockResolvedValue({ count: 1, subscription: makeSubscription() })
    const unlink = vi
      .spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
      .mockResolvedValue(makeSubscription())
    const payment = makeTransaction({ subscription_id: 'subscription-streamflix' })
    const fetchOne = vi.spyOn(api, 'fetchTransaction')
    const { saved, subscriptionSelect } = await render(true, payment, [makeSubscription(), power])

    fetchOne.mockResolvedValueOnce({ ...payment, subscription_id: 'subscription-power' })
    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-power')
    await flushPromises()
    expect(link).toHaveBeenCalledWith('subscription-power', [payment.id])
    expect(notices.value.at(-1)?.text).toBe('Linked it to Power')

    fetchOne.mockResolvedValueOnce({ ...payment, subscription_id: null })
    subscriptionSelect()!.vm.$emit('update:modelValue', null)
    await flushPromises()
    expect(unlink).toHaveBeenCalledWith('subscription-power', payment.id)
    expect(notices.value.at(-1)?.text).toBe('Took it off the subscription')
    expect(saved).toHaveBeenCalledTimes(2)
  })

  it('does nothing when the subscription it already has is chosen again', async () => {
    const link = vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments')
    const unlink = vi.spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
    const { subscriptionSelect } = await render(
      true,
      makeTransaction({ subscription_id: 'subscription-streamflix' }),
      [makeSubscription()],
    )

    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()

    expect(link).not.toHaveBeenCalled()
    expect(unlink).not.toHaveBeenCalled()
  })

  it('offers the subscriptions still being matched, and the paused one the payment is in', async () => {
    const paused = makeSubscription({ id: 'subscription-paused', name: 'Old gym', active: false })
    const other = makeSubscription({ id: 'subscription-other', name: 'Other', active: false })
    const { subscriptionSelect } = await render(
      true,
      makeTransaction({ subscription_id: 'subscription-paused' }),
      [makeSubscription(), paused, other],
    )

    expect(
      subscriptionSelect()!
        .props('items')
        .map((item: { title: string }) => item.title),
    ).toEqual(['Streamflix', 'Old gym'])
  })

  it('shows viewers, and money coming in, the subscription only as a name or not at all', async () => {
    const viewer = await render(
      false,
      makeTransaction({ subscription_id: 'subscription-streamflix' }),
      [makeSubscription()],
    )
    expect(viewer.subscriptionSelect()).toBeUndefined()

    const income = await render(true, { ...salary, subscription_id: null }, [makeSubscription()])
    expect(income.subscriptionSelect()).toBeUndefined()
  })

  it('shows what went wrong when a payment could not be linked, and ignores changes meanwhile', async () => {
    let fail!: (error: Error) => void
    const link = vi.spyOn(subscriptionsApi, 'linkSubscriptionPayments').mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject
        }),
    )
    const { subscriptionSelect } = await render(true, wholeFoods, [makeSubscription()])

    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()
    subscriptionSelect()!.vm.$emit('update:modelValue', 'subscription-streamflix')
    await flushPromises()
    expect(link).toHaveBeenCalledTimes(1)

    fail(new ApiError(404, 'That subscription no longer exists.'))
    await flushPromises()
    expect(page().find('[data-test="transaction-info-error"]').text()).toContain(
      'That subscription no longer exists.',
    )
  })

  it('does not send an unchanged category and shows category update errors', async () => {
    const update = vi
      .spyOn(api, 'updateTransaction')
      .mockRejectedValue(new ApiError(422, 'Could not save the category.'))
    const { wrapper } = await render()
    const picker = wrapper.findComponent({ name: 'CategoryPicker' })
    picker.vm.$emit('update:modelValue', groceries.id)
    await flushPromises()
    expect(update).not.toHaveBeenCalled()

    picker.vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    expect(update).toHaveBeenCalledWith(describedTransaction.id, { category_id: coffee.id })
    expect(page().find('[data-test="transaction-info-error"]').text()).toContain(
      'Could not save the category.',
    )
  })

  it('ignores additional category changes while one is saving', async () => {
    let resolveUpdate!: (transaction: Transaction) => void
    const update = vi.spyOn(api, 'updateTransaction').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpdate = resolve
        }),
    )
    const { wrapper } = await render()
    const picker = wrapper.findComponent({ name: 'CategoryPicker' })
    picker.vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    picker.vm.$emit('update:modelValue', null)
    expect(update).toHaveBeenCalledTimes(1)

    resolveUpdate({ ...wholeFoods, category_id: coffee.id })
    await flushPromises()
  })
})
