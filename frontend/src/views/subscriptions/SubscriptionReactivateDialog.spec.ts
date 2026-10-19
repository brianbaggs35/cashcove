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
import SubscriptionReactivateDialog from '@/views/subscriptions/SubscriptionReactivateDialog.vue'
import { nextOnSchedule } from '@/views/subscriptions/recurrence'

/** A day this many days from today, so what a test says of "the past" never goes stale. */
const day = (days: number) => addDays(todayIso(), days)
const shown = (value: string) => formatShortDate(fromIsoDate(value))

/** One that was cancelled long ago, so its next payment is a day that has gone by. */
const lapsed = (changes: Partial<Subscription> = {}) =>
  makeSubscription({
    frequency: 'weekly',
    next_due_date: day(-47),
    cancelled_on: day(-50),
    ends_on: day(-47),
    ...changes,
  })

async function render(subscription: Subscription | null = lapsed()) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(SubscriptionReactivateDialog, {
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
  const nextDue = () => mounted.wrapper.findComponent({ name: 'DateField' })
  return { ...mounted, open, saved, overlay, field, nextDue }
}

async function makeFormValid(wrapper: VueWrapper, valid = true) {
  wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', valid)
  await flushPromises()
}

describe('SubscriptionReactivateDialog', () => {
  it('asks whether to reactivate it, and says it picks up as a regular one', async () => {
    const { overlay, field } = await render()

    expect(overlay().find('h2').text()).toBe('Reactivate Streamflix?')
    expect(overlay().text()).toContain(
      'It picks up again as a regular subscription: payments are matched, reminders are sent and it counts toward what you pay.',
    )
    expect(field('reactivate-day').text()).toContain('Next payment date')
    expect(field('reactivate-day').text()).toContain(
      'When is it next due? Reminders and due dates count from this day.',
    )
  })

  it.each([
    // Fifty-two weekly payments make a year.
    ['weekly', '$64.96 a month, $779.48 a year'],
    ['monthly', '$14.99 a month, $179.88 a year'],
  ] as const)(
    'says what it will cost again if it is paid %s, in the account’s currency',
    async (frequency, cost) => {
      const { field } = await render(lapsed({ frequency }))

      expect(field('reactivate-cost').text()).toBe(
        `It counts toward what you pay again: about ${cost}.`,
      )
    },
  )

  it('starts with the next day on its old schedule, so it does not come back already late', async () => {
    const subscription = lapsed()
    const onSchedule = nextOnSchedule(subscription)
    const { nextDue, field } = await render(subscription)

    expect(onSchedule >= todayIso()).toBe(true)
    expect(nextDue().props('modelValue')).toBe(onSchedule)
    expect(field('reactivate-suggested').text()).toBe(
      `On its schedule, ${formatListDate(onSchedule)}`,
    )
    expect(field('reactivate-suggested').attributes('aria-pressed')).toBe('true')
    expect(field('reactivate-today').attributes('aria-pressed')).toBe('false')
  })

  it('keeps a next payment that is still to come, which is also where its schedule is', async () => {
    const next = day(12)
    const { nextDue } = await render(
      makeSubscription({ cancelled_on: day(-1), ends_on: day(1), next_due_date: next }),
    )

    expect(nextDue().props('modelValue')).toBe(next)
  })

  it('offers only today when its schedule falls due today', async () => {
    const { nextDue, field } = await render(lapsed({ next_due_date: todayIso() }))

    expect(nextDue().props('modelValue')).toBe(todayIso())
    expect(field('reactivate-suggested').exists()).toBe(false)
    expect(field('reactivate-today').attributes('aria-pressed')).toBe('true')
  })

  it('reactivates it from the day chosen, as of today, and says when its next payment is', async () => {
    const subscription = lapsed()
    const onSchedule = nextOnSchedule(subscription)
    const reactivated = makeSubscription({ next_due_date: onSchedule })
    const reactivate = vi
      .spyOn(subscriptionsApi, 'reactivateSubscription')
      .mockResolvedValue(reactivated)
    const { wrapper, field, saved, open } = await render(subscription)

    await makeFormValid(wrapper)
    await field('reactivate-confirm').trigger('click')
    await flushPromises()

    expect(reactivate).toHaveBeenCalledWith(subscription.id, {
      next_due_date: onSchedule,
      today: todayIso(),
    })
    expect(notices.value.at(-1)?.text).toBe(
      `Reactivated Streamflix. Its next payment is ${shown(onSchedule)}`,
    )
    expect(saved).toHaveBeenCalledWith(reactivated)
    expect(open.value).toBe(false)
  })

  it('can start from another day, such as today', async () => {
    const subscription = lapsed()
    const reactivate = vi
      .spyOn(subscriptionsApi, 'reactivateSubscription')
      .mockResolvedValue(subscription)
    const { wrapper, field } = await render(subscription)

    await field('reactivate-today').trigger('click')
    await makeFormValid(wrapper)
    await field('reactivate-confirm').trigger('click')
    await flushPromises()

    expect(reactivate).toHaveBeenCalledWith(subscription.id, {
      next_due_date: todayIso(),
      today: todayIso(),
    })
  })

  it('reactivates a bill through the bills API, in its own words', async () => {
    const bill = makeBill({
      frequency: 'monthly',
      next_due_date: day(-40),
      cancelled_on: day(-45),
      ends_on: day(-40),
    })
    const reactivate = vi.spyOn(billsApi, 'reactivateBill').mockResolvedValue(bill)
    const reactivateSubscription = vi.spyOn(subscriptionsApi, 'reactivateSubscription')
    const { wrapper, field, overlay } = await render(bill)

    expect(overlay().find('h2').text()).toBe('Reactivate City Power?')
    expect(overlay().text()).toContain('It picks up again as a regular bill')
    expect(field('reactivate-day').text()).toContain('Next due date')
    expect(field('reactivate-confirm').text()).toBe('Reactivate bill')
    // A bill that changes every time costs what recent payments say.
    expect(field('reactivate-cost').text()).toBe(
      'It counts toward what you pay again: about $96.40 a month, $1,156.80 a year.',
    )
    await makeFormValid(wrapper)
    await field('reactivate-confirm').trigger('click')
    await flushPromises()

    expect(reactivate).toHaveBeenCalledWith(bill.id, {
      next_due_date: nextOnSchedule(bill),
      today: todayIso(),
    })
    expect(reactivateSubscription).not.toHaveBeenCalled()
  })

  it('stays as it was when the person says not now', async () => {
    const reactivate = vi.spyOn(subscriptionsApi, 'reactivateSubscription')
    const { overlay, open, saved } = await render()

    await overlay()
      .findAll('button')
      .find((button) => button.text() === 'Not now')!
      .trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
    expect(reactivate).not.toHaveBeenCalled()
    expect(saved).not.toHaveBeenCalled()
  })

  it('closes from the dialog’s own close button, and does nothing else', async () => {
    const reactivate = vi.spyOn(subscriptionsApi, 'reactivateSubscription')
    const { overlay, open } = await render()

    await overlay().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
    expect(reactivate).not.toHaveBeenCalled()
  })

  it('does not reactivate until a day is chosen', async () => {
    const reactivate = vi.spyOn(subscriptionsApi, 'reactivateSubscription')
    const { wrapper, field, nextDue } = await render()

    nextDue().vm.$emit('update:modelValue', null)
    await makeFormValid(wrapper, false)
    expect(field('reactivate-confirm').attributes('disabled')).toBeDefined()
    await wrapper.findComponent({ name: 'VForm' }).trigger('submit')
    await flushPromises()

    expect(reactivate).not.toHaveBeenCalled()
  })

  it('submits from the form too, once it is valid', async () => {
    const reactivate = vi
      .spyOn(subscriptionsApi, 'reactivateSubscription')
      .mockResolvedValue(makeSubscription())
    const { wrapper } = await render()

    await makeFormValid(wrapper)
    await wrapper.findComponent({ name: 'VForm' }).trigger('submit')
    await flushPromises()

    expect(reactivate).toHaveBeenCalledOnce()
  })

  it('shows why it could not be reactivated, and stays open to try again', async () => {
    vi.spyOn(subscriptionsApi, 'reactivateSubscription').mockRejectedValue(
      new ApiError(
        409,
        'This subscription is paid from an account that is closed. Choose an open account for it in Edit, then reactivate it.',
        { code: 'closed_account' },
      ),
    )
    const { wrapper, field, open, saved, nextDue } = await render()

    await makeFormValid(wrapper)
    await field('reactivate-confirm').trigger('click')
    await flushPromises()

    expect(field('reactivate-error').text()).toContain('paid from an account that is closed')
    expect(open.value).toBe(true)
    expect(saved).not.toHaveBeenCalled()
    expect(notices.value).toEqual([])

    // Choosing another day starts again, with no old message.
    nextDue().vm.$emit('update:modelValue', day(3))
    await flushPromises()
    expect(field('reactivate-error').exists()).toBe(false)
  })

  it('puts what is wrong with the day by the day', async () => {
    vi.spyOn(subscriptionsApi, 'reactivateSubscription').mockRejectedValue(
      new ApiError(422, 'Check the day.', { fields: { next_due_date: 'Pick a later day.' } }),
    )
    const { wrapper, field } = await render()

    await makeFormValid(wrapper)
    await field('reactivate-confirm').trigger('click')
    await flushPromises()

    expect(field('reactivate-day').text()).toContain('Pick a later day.')
    expect(field('reactivate-error').exists()).toBe(false)
  })

  it('starts afresh each time it opens', async () => {
    const subscription = lapsed()
    const { open, nextDue, field } = await render(subscription)
    await field('reactivate-today').trigger('click')
    expect(nextDue().props('modelValue')).toBe(todayIso())

    open.value = false
    await flushPromises()
    open.value = true
    await flushPromises()

    expect(nextDue().props('modelValue')).toBe(nextOnSchedule(subscription))
  })

  it('has nothing to name or to say it costs before one is chosen', async () => {
    const { overlay, field } = await render(null)

    expect(overlay().find('h2').text()).toBe('Reactivate the subscription?')
    expect(field('reactivate-cost').exists()).toBe(false)
  })
})
