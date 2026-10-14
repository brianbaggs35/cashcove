import type { PaymentSummary } from '@/api/subscriptions'
import { makeSubscription } from '@/test/subscriptions'
import { mountWithPlugins } from '@/test/mount'
import { addDays, todayIso } from '@/utils/dates'
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
})
