import type { PaymentSummary } from '@/api/subscriptions'
import { makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { addDays, formatListDate, fromIsoDate, todayIso } from '@/utils/dates'
import { formatShortDate } from '@/utils/format'
import SubscriptionStats from '@/views/subscriptions/SubscriptionStats.vue'

const summary: PaymentSummary = {
  total: '44.97',
  average: '14.99',
  highest: '14.99',
  lowest: '14.99',
  first_on: '2026-07-15',
  this_year: '44.97',
}

async function render(
  changes: Parameters<typeof makeSubscription>[0] = {},
  props: Partial<{ summary: PaymentSummary; currency: string }> = {},
) {
  const { wrapper } = await mountWithPlugins(SubscriptionStats, {
    props: { subscription: makeSubscription(changes), summary, ...props },
  })
  const text = (name: string) => wrapper.find(`[data-test="${name}"]`).text()
  return { wrapper, text }
}

describe('SubscriptionStats', () => {
  it('shows what the next payment is, what the subscription costs and what it has cost so far', async () => {
    const { text } = await render({ next_due_date: addDays(todayIso(), 6) })

    expect(text('stat-expected')).toContain('$14.99')
    expect(text('stat-expected')).toContain('Monthly')
    expect(text('stat-cost')).toContain('$14.99')
    expect(text('stat-cost')).toContain('$179.88 a year')
    expect(text('stat-paid')).toContain('$44.97')
    expect(text('stat-paid')).toContain('2 payments since Jul 15, 2026')
  })

  it('says when it is due in days, and in the error color once it is overdue', async () => {
    const soon = await render({ next_due_date: addDays(todayIso(), 6) })
    expect(soon.text('stat-due')).toContain('Due in 6 days')
    expect(soon.wrapper.find('.text-error').exists()).toBe(false)

    const late = await render({ next_due_date: addDays(todayIso(), -2) })
    expect(late.text('stat-due')).toContain('Overdue by 2 days')
    expect(late.wrapper.find('.text-error').text()).toBe('Overdue by 2 days')
  })

  it('leaves the year out of a day in the year it is, and puts it in for another', async () => {
    const thisYear = new Date().getFullYear()
    const now = await render({ next_due_date: `${thisYear}-12-24` })
    expect(now.text('stat-due')).toContain('Dec 24')
    expect(now.text('stat-due')).not.toContain(String(thisYear))

    const later = await render({ next_due_date: `${thisYear + 2}-01-05` })
    expect(later.text('stat-due')).toContain(`Jan 5, ${thisYear + 2}`)
  })

  it('does not call a paused one late, since nothing is tracking it', async () => {
    const { text, wrapper } = await render({
      active: false,
      next_due_date: addDays(todayIso(), -9),
    })

    expect(text('stat-due')).toContain('Paused')
    expect(text('stat-due')).not.toContain('Overdue')
    expect(wrapper.find('.text-error').exists()).toBe(false)
  })

  it('estimates a bill that changes every time, from what is expected of it', async () => {
    const { text } = await render({
      amount: '96.40',
      amount_varies: true,
      expected_amount: '111.92',
      frequency: 'monthly',
    })

    expect(text('stat-expected')).toContain('~')
    expect(text('stat-expected')).toContain('$111.92')
    expect(text('stat-expected')).toContain('changes every time')
    expect(text('stat-cost')).toContain('$1,343.04 a year')
  })

  it('counts what a weekly one costs a month, in its account’s currency', async () => {
    const { text } = await render({ frequency: 'weekly' }, { currency: 'CAD' })

    expect(text('stat-cost')).toContain('CA$64.96')
    expect(text('stat-cost')).toContain('CA$779.48 a year')
  })

  it('counts what one paid every two months costs a month, from the six payments a year', async () => {
    const { text } = await render({ frequency: 'bimonthly' })

    expect(text('stat-expected')).toContain('Every two months')
    expect(text('stat-cost')).toContain('$7.50')
    expect(text('stat-cost')).toContain('$89.94 a year')
  })

  it('reads a first payment that has not happened yet as just a count', async () => {
    const none = await render(
      { payment_count: 0 },
      { summary: { ...summary, total: '0.00', first_on: null } },
    )
    expect(none.text('stat-paid')).toContain('$0.00')
    expect(none.text('stat-paid')).toContain('0 payments')
    expect(none.text('stat-paid')).not.toContain('since')

    const one = await render({ payment_count: 1 })
    expect(one.text('stat-paid')).toContain('1 payment since')
  })

  describe('when it ends', () => {
    const inDays = (days: number) => addDays(todayIso(), days)
    const long = (day: string) => formatListDate(day, 'en-US')

    it('shows when it is due as usual while it carries on until later', async () => {
      const { text } = await render({ ends_on: inDays(90), next_due_date: inDays(6) })

      expect(text('stat-due')).toContain('Next due')
      expect(text('stat-due')).toContain('Due in 6 days')
    })

    it('shows when it ends, and that nothing more is due, once the next payment would be after it', async () => {
      const { text, wrapper } = await render({
        ends_on: inDays(6),
        next_due_date: inDays(6),
      })

      expect(text('stat-due')).toContain('Ends')
      expect(text('stat-due')).toContain(long(inDays(6)))
      expect(text('stat-due')).toContain('No more payments')
      expect(wrapper.find('.text-error').exists()).toBe(false)
    })

    it('says what each payment was and what it used to cost, for one that has stopped', async () => {
      const { text } = await render({
        cancelled_on: inDays(-1),
        ends_on: inDays(30),
        next_due_date: inDays(30),
      })

      expect(text('stat-expected')).toContain('Each payment')
      expect(text('stat-expected')).not.toContain('Next payment')
      expect(text('stat-cost')).toContain('Used to cost')
      expect(text('stat-cost')).not.toContain('Costs about')
      // The figures are still what they were.
      expect(text('stat-expected')).toContain('$14.99')
      expect(text('stat-cost')).toContain('$179.88 a year')
    })

    it('still says next payment and costs about for one that carries on, or ends later', async () => {
      const running = await render({ next_due_date: inDays(6) })
      expect(running.text('stat-expected')).toContain('Next payment')
      expect(running.text('stat-cost')).toContain('Costs about')

      const ending = await render({ ends_on: inDays(90), next_due_date: inDays(6) })
      expect(ending.text('stat-expected')).toContain('Next payment')
      expect(ending.text('stat-cost')).toContain('Costs about')
    })

    it('talks of when a cancelled one ends, not red or late, even with a payment due before then', async () => {
      const { text, wrapper } = await render({
        cancelled_on: inDays(-1),
        ends_on: inDays(30),
        next_due_date: inDays(-3),
      })

      expect(text('stat-due')).toContain('Ends')
      expect(text('stat-due')).toContain(long(inDays(30)))
      expect(text('stat-due')).toContain(`Cancelled ${formatShortDate(fromIsoDate(inDays(-1)))}`)
      expect(text('stat-due')).not.toContain('Overdue')
      expect(wrapper.find('.text-error').exists()).toBe(false)
    })

    it('says when it was cancelled, and does not call what was due overdue', async () => {
      const { text, wrapper } = await render({
        cancelled_on: inDays(-5),
        ends_on: inDays(-2),
        next_due_date: inDays(-2),
      })

      expect(text('stat-due')).toContain('Ended')
      expect(text('stat-due')).toContain(long(inDays(-2)))
      expect(text('stat-due')).toContain(`Cancelled ${formatShortDate(fromIsoDate(inDays(-5)))}`)
      expect(wrapper.find('.text-error').exists()).toBe(false)
    })

    it('still says it is paused, for one that is paused and ends later', async () => {
      const { text } = await render({
        active: false,
        ends_on: inDays(90),
        next_due_date: inDays(6),
      })
      expect(text('stat-due')).toContain('Paused')
    })
  })
})
