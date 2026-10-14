import { flushPromises } from '@vue/test-utils'

import * as billsApi from '@/api/bills'
import * as subscriptionsApi from '@/api/subscriptions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { unlinkPayment, useRecurringActions } from '@/composables/useRecurringActions'
import { answer } from '@/test/confirm'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import { defineComponent } from 'vue'

/** The actions, set up as a page would in its own setup, with what it does after and on failure. */
async function setUp() {
  const changed = vi.fn().mockResolvedValue(undefined)
  const failed = vi.fn()
  let actions!: ReturnType<typeof useRecurringActions>
  await mountWithPlugins(
    defineComponent({
      setup() {
        actions = useRecurringActions(changed, failed)
        return () => null
      },
    }),
  )
  return { actions, changed, failed }
}

describe('useRecurringActions', () => {
  it('pauses and resumes matching through the API of its kind, and loads it afresh', async () => {
    const subscription = makeSubscription()
    const bill = makeBill({ active: false })
    const updateSubscription = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockResolvedValue(subscription)
    const updateBill = vi.spyOn(billsApi, 'updateBill').mockResolvedValue(bill)
    const { actions, changed, failed } = await setUp()

    await actions.toggle(subscription)
    expect(updateSubscription).toHaveBeenCalledWith(subscription.id, { active: false })
    expect(notices.value.at(-1)?.text).toBe('Paused automatic matching')

    await actions.toggle(bill)
    expect(updateBill).toHaveBeenCalledWith(bill.id, { active: true })
    expect(notices.value.at(-1)?.text).toBe('Resumed automatic matching')
    expect(changed).toHaveBeenCalledTimes(2)
    expect(failed).not.toHaveBeenCalled()
  })

  it('says why pausing did not work, and does not load it afresh', async () => {
    vi.spyOn(subscriptionsApi, 'updateSubscription').mockRejectedValue(new Error('No connection'))
    const { actions, changed, failed } = await setUp()

    await actions.toggle(makeSubscription())

    expect(failed).toHaveBeenCalledWith('No connection')
    expect(changed).not.toHaveBeenCalled()
  })

  it('makes the last payment the amount, and says so in the household currency', async () => {
    const subscription = makeSubscription({ amount: '15.49', last_payment_amount: '17.99' })
    const update = vi.spyOn(subscriptionsApi, 'updateSubscription').mockResolvedValue(subscription)
    const { actions, changed } = await setUp()

    await actions.updateAmount(subscription)

    expect(update).toHaveBeenCalledWith(subscription.id, { amount: '17.99' })
    expect(notices.value.at(-1)?.text).toBe('Updated Streamflix to $17.99')
    expect(changed).toHaveBeenCalledOnce()
  })

  it('has nothing to update to without a payment, and says why when it fails', async () => {
    const update = vi
      .spyOn(subscriptionsApi, 'updateSubscription')
      .mockRejectedValue(new Error('No connection'))
    const { actions, changed, failed } = await setUp()

    await actions.updateAmount(makeSubscription({ last_payment_amount: null }))
    expect(update).not.toHaveBeenCalled()

    await actions.updateAmount(makeSubscription({ last_payment_amount: '17.99' }))
    expect(failed).toHaveBeenCalledWith('No connection')
    expect(changed).not.toHaveBeenCalled()
  })

  it('deletes only once asked to confirm, in the words of its kind', async () => {
    const subscription = makeSubscription()
    const bill = makeBill()
    const deleteSubscription = vi
      .spyOn(subscriptionsApi, 'deleteSubscription')
      .mockResolvedValue(undefined)
    const deleteBill = vi.spyOn(billsApi, 'deleteBill').mockResolvedValue(undefined)
    const { actions } = await setUp()

    const cancelled = actions.remove(subscription)
    await flushPromises()
    expect(confirmRequest.value).toMatchObject({
      title: 'Delete Streamflix?',
      confirmText: 'Delete subscription',
      tone: 'error',
    })
    await answer(false)
    expect(await cancelled).toBe(false)
    expect(deleteSubscription).not.toHaveBeenCalled()

    const confirmed = actions.remove(bill)
    await flushPromises()
    expect(confirmRequest.value?.confirmText).toBe('Delete bill')
    await answer(true)
    expect(await confirmed).toBe(true)
    expect(deleteBill).toHaveBeenCalledWith(bill.id)
    expect(notices.value.at(-1)?.text).toBe('Deleted City Power')
  })
})

describe('unlinkPayment', () => {
  const payment = { id: 'transaction-1', payee: 'Streamflix' }

  it('asks first, in the error tone, and says what stays and what goes', async () => {
    const subscription = makeSubscription()
    const unlink = vi.spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')

    const asked = unlinkPayment(subscription, payment)
    await flushPromises()

    expect(unlink).not.toHaveBeenCalled()
    expect(confirmRequest.value).toMatchObject({
      title: 'Unlink Streamflix?',
      confirmText: 'Unlink payment',
      tone: 'error',
    })
    expect(confirmRequest.value?.text).toBe(
      'It stays in your history with its category, but no longer counts toward Streamflix, its total or the budgets that count it.',
    )
    await answer(false)
    expect(await asked).toBeNull()
  })

  it('takes the payment off through the API of its kind once confirmed, and says so', async () => {
    const updated = makeSubscription({ payment_count: 1 })
    const unlinkSubscription = vi
      .spyOn(subscriptionsApi, 'unlinkSubscriptionPayment')
      .mockResolvedValue(updated)
    const bill = makeBill()
    const unlinkBill = vi.spyOn(billsApi, 'unlinkBillPayment').mockResolvedValue(bill)

    const subscriptionDone = unlinkPayment(makeSubscription(), payment)
    await flushPromises()
    await answer(true)
    expect(await subscriptionDone).toEqual(updated)
    expect(unlinkSubscription).toHaveBeenCalledWith('subscription-streamflix', 'transaction-1')
    expect(notices.value.at(-1)?.text).toBe('Unlinked Streamflix from Streamflix')

    const billDone = unlinkPayment(bill, payment)
    await flushPromises()
    await answer(true)
    expect(await billDone).toEqual(bill)
    expect(unlinkBill).toHaveBeenCalledWith('bill-power', 'transaction-1')
    expect(unlinkSubscription).toHaveBeenCalledTimes(1)
  })

  it('keeps the question up with why when it fails, rather than saying it was done', async () => {
    vi.spyOn(subscriptionsApi, 'unlinkSubscriptionPayment').mockRejectedValue(
      new Error('No connection'),
    )

    const asked = unlinkPayment(makeSubscription(), payment)
    await flushPromises()
    // The dialog runs the action and shows what went wrong, leaving the person to try again or stop.
    await expect(confirmRequest.value!.action!()).rejects.toThrow('No connection')
    expect(notices.value).toEqual([])
    await answer(false)

    expect(await asked).toBeNull()
    expect(notices.value).toEqual([])
  })
})
