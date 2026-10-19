import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as billsApi from '@/api/bills'
import { ApiError } from '@/api/client'
import type { Subscription } from '@/api/subscriptions'
import * as subscriptionsApi from '@/api/subscriptions'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import { addDays, formatListDate, fromIsoDate, todayIso } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import SubscriptionCancelDialog from '@/views/subscriptions/SubscriptionCancelDialog.vue'

/** A day this many days from today, so what a test says of "the future" never goes stale. */
const day = (days: number) => addDays(todayIso(), days)
const shown = (value: string) => formatShortDate(fromIsoDate(value))

async function render(subscription: Subscription | null = makeSubscription()) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(SubscriptionCancelDialog, {
        subscription,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
      }),
  })
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  open.value = true
  await flushPromises()
  const prefix = subscription?.kind ?? 'subscription'
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const field = (name: string) => overlay().find(`[data-test="${prefix}-${name}"]`)
  const endDate = () => mounted.wrapper.findComponent({ name: 'DateField' })
  return { ...mounted, open, saved, overlay, field, endDate }
}

async function makeFormValid(wrapper: VueWrapper, valid = true) {
  wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', valid)
  await flushPromises()
}

describe('SubscriptionCancelDialog', () => {
  it('asks whether to cancel it, and says it is kept and can be reactivated', async () => {
    const { overlay, field } = await render()

    expect(overlay().find('h2').text()).toBe('Cancel Streamflix?')
    expect(overlay().text()).toContain('It stays in Cashcove with all its payments')
    expect(overlay().text()).toContain('you can reactivate it any time')
    expect(field('cancel-day').text()).toContain('No payment is expected on or after this day.')
  })

  it('says what it stops costing once it has ended, in the account’s currency', async () => {
    const { field } = await render()

    expect(field('cancel-saving').text()).toBe(
      'Once it ends, you stop paying about $14.99 a month, $179.88 a year.',
    )
  })

  it('starts with the day it would next be paid, when that is after today', async () => {
    const next = day(9)
    const { endDate, field } = await render(makeSubscription({ next_due_date: next }))

    expect(endDate().props('modelValue')).toBe(next)
    expect(field('cancel-suggested').text()).toBe(`Next payment, ${formatListDate(next)}`)
    expect(field('cancel-suggested').attributes('aria-pressed')).toBe('true')
    expect(field('cancel-today').attributes('aria-pressed')).toBe('false')
  })

  it('starts with today when the next payment is a day that has gone by, and offers no other', async () => {
    const { endDate, field } = await render(makeSubscription({ next_due_date: day(-4) }))

    expect(endDate().props('modelValue')).toBe(todayIso())
    expect(field('cancel-suggested').exists()).toBe(false)
    expect(field('cancel-today').attributes('aria-pressed')).toBe('true')
  })

  it('starts with today when the next payment is today, which is the same day', async () => {
    const { endDate, field } = await render(makeSubscription({ next_due_date: todayIso() }))

    expect(endDate().props('modelValue')).toBe(todayIso())
    expect(field('cancel-suggested').exists()).toBe(false)
  })

  it('cancels it as of today, on the day chosen, and says when it ends and where it went', async () => {
    const next = day(9)
    const subscription = makeSubscription({ next_due_date: next })
    const cancelled = { ...subscription, cancelled_on: todayIso(), ends_on: next }
    const cancel = vi.spyOn(subscriptionsApi, 'cancelSubscription').mockResolvedValue(cancelled)
    const { wrapper, field, saved, open } = await render(subscription)

    await makeFormValid(wrapper)
    await field('cancel-confirm').trigger('click')
    await flushPromises()

    expect(cancel).toHaveBeenCalledWith(subscription.id, {
      cancelled_on: todayIso(),
      ends_on: next,
    })
    expect(notices.value.at(-1)?.text).toBe(
      `Cancelled Streamflix. It ends on ${shown(next)}. It is kept under Cancelled`,
    )
    expect(saved).toHaveBeenCalledWith(cancelled)
    expect(open.value).toBe(false)
  })

  it('just says where it went when it ends today', async () => {
    const subscription = makeSubscription({ next_due_date: day(-1) })
    vi.spyOn(subscriptionsApi, 'cancelSubscription').mockResolvedValue(subscription)
    const { wrapper, field } = await render(subscription)

    await makeFormValid(wrapper)
    await field('cancel-confirm').trigger('click')
    await flushPromises()

    expect(notices.value.at(-1)?.text).toBe('Cancelled Streamflix. It is kept under Cancelled')
  })

  it('cancels a bill through the bills API, in its own words', async () => {
    const bill = makeBill({ next_due_date: day(5) })
    const cancel = vi.spyOn(billsApi, 'cancelBill').mockResolvedValue(bill)
    const cancelSubscription = vi.spyOn(subscriptionsApi, 'cancelSubscription')
    const { wrapper, field, overlay } = await render(bill)

    expect(overlay().find('h2').text()).toBe('Cancel City Power?')
    expect(overlay().text()).toContain('Keep bill')
    expect(field('cancel-confirm').text()).toBe('Cancel bill')
    // A bill that changes every time costs what recent payments say.
    expect(field('cancel-saving').text()).toBe(
      'Once it ends, you stop paying about $96.40 a month, $1,156.80 a year.',
    )
    await makeFormValid(wrapper)
    await field('cancel-confirm').trigger('click')
    await flushPromises()

    expect(cancel).toHaveBeenCalledWith(bill.id, { cancelled_on: todayIso(), ends_on: day(5) })
    expect(cancelSubscription).not.toHaveBeenCalled()
  })

  it('stays as it was when the person keeps it', async () => {
    const cancel = vi.spyOn(subscriptionsApi, 'cancelSubscription')
    const { overlay, open, saved } = await render()

    await overlay()
      .findAll('button')
      .find((button) => button.text() === 'Keep subscription')!
      .trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
  })

  it('closes from the dialog’s own close button, and does nothing else', async () => {
    const cancel = vi.spyOn(subscriptionsApi, 'cancelSubscription')
    const { overlay, open } = await render()

    await overlay().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('does not cancel until a day is chosen', async () => {
    const cancel = vi.spyOn(subscriptionsApi, 'cancelSubscription')
    const { wrapper, field, endDate } = await render()

    endDate().vm.$emit('update:modelValue', null)
    await makeFormValid(wrapper, false)
    expect(field('cancel-confirm').attributes('disabled')).toBeDefined()
    await wrapper.findComponent({ name: 'VForm' }).trigger('submit')
    await flushPromises()

    expect(cancel).not.toHaveBeenCalled()
  })

  it('submits from the form too, once it is valid', async () => {
    const cancel = vi
      .spyOn(subscriptionsApi, 'cancelSubscription')
      .mockResolvedValue(makeSubscription())
    const { wrapper } = await render()

    await makeFormValid(wrapper)
    await wrapper.findComponent({ name: 'VForm' }).trigger('submit')
    await flushPromises()

    expect(cancel).toHaveBeenCalledOnce()
  })

  it('shows why it could not be cancelled, and stays open to try again', async () => {
    vi.spyOn(subscriptionsApi, 'cancelSubscription').mockRejectedValue(
      new ApiError(409, 'This subscription is already cancelled or has ended.', {
        code: 'already_stopped',
      }),
    )
    const { wrapper, field, open, saved, endDate } = await render()

    await makeFormValid(wrapper)
    await field('cancel-confirm').trigger('click')
    await flushPromises()

    expect(field('cancel-error').text()).toContain('already cancelled or has ended')
    expect(open.value).toBe(true)
    expect(saved).not.toHaveBeenCalled()
    expect(notices.value).toEqual([])

    // Choosing another day starts again, with no old message.
    endDate().vm.$emit('update:modelValue', day(3))
    await flushPromises()
    expect(field('cancel-error').exists()).toBe(false)
  })

  it('puts what is wrong with the day by the day', async () => {
    vi.spyOn(subscriptionsApi, 'cancelSubscription').mockRejectedValue(
      new ApiError(422, 'Check the day.', { fields: { ends_on: 'Pick a later day.' } }),
    )
    const { wrapper, field } = await render()

    await makeFormValid(wrapper)
    await field('cancel-confirm').trigger('click')
    await flushPromises()

    expect(field('cancel-day').text()).toContain('Pick a later day.')
    expect(field('cancel-error').exists()).toBe(false)
  })

  it('starts afresh each time it opens', async () => {
    const next = day(9)
    const { open, endDate, field } = await render(makeSubscription({ next_due_date: next }))
    await field('cancel-today').trigger('click')
    expect(endDate().props('modelValue')).toBe(todayIso())

    open.value = false
    await flushPromises()
    open.value = true
    await flushPromises()

    expect(endDate().props('modelValue')).toBe(next)
  })

  it('has nothing to name or to say it saves before one is chosen', async () => {
    const { overlay, field } = await render(null)

    expect(overlay().find('h2').text()).toBe('Cancel the subscription?')
    expect(field('cancel-saving').exists()).toBe(false)
  })
})
