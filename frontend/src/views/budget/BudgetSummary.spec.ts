import { flushPromises } from '@vue/test-utils'

import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { click } from '@/test/dom'
import { makePeriod } from '@/test/budgets'
import { menuSettled } from '@/test/confirm'
import BudgetSummary from '@/views/budget/BudgetSummary.vue'

async function render(period = makePeriod(), readonly = false) {
  const mounted = await mountWithPlugins(BudgetSummary, {
    width: 1280,
    props: { period, readonly },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('BudgetSummary', () => {
  it('says what is left to spend, how far through the amount spending is, and what the period came to', async () => {
    const { find, wrapper } = await render()

    expect(find('summary-heading').text()).toBe('Left to spend')
    expect(find('summary-left').text()).toBe('$750.00')
    expect(find('summary-of').text()).toBe('of $2,000.00 for the period')
    expect(find('summary-status').text()).toBe('On track')
    expect(find('summary-percent').text()).toBe('63% spent')
    expect(find('summary-time').text()).toBe('10 days left')
    expect(find('summary-meter').attributes('aria-label')).toBe('63% of the budget spent')
    expect(find('summary-meter').attributes('aria-valuenow')).toBe('63')
    expect(find('summary-meter').find('.v-progress-linear__determinate').classes()).toContain(
      'bg-primary',
    )
    expect(find('summary-pace').attributes('title')).toBe(
      'An even pace would have spent $1,333.33 by now',
    )
    expect(find('summary-pace-note').text()).toBe(
      "At this pace you'll spend $1,875.00, which is $125.00 under budget.",
    )
    expect(wrapper.findAll('[data-test="tile-value"]').map((tile) => tile.text())).toEqual([
      '$2,400.00',
      '$1,250.00',
      '+$1,150.00',
    ])
  })

  it('says when the budget is over', async () => {
    const { find } = await render(
      makePeriod({ spent: '2500.00', left: '-500.00', saved: '-100.00', projected: '3750.00' }),
    )

    expect(find('summary-heading').text()).toBe('Overspent by')
    expect(find('summary-left').text()).toBe('$500.00')
    expect(find('summary-left').classes()).toContain('text-error')
    expect(find('summary-status').text()).toBe('Over budget')
    expect(find('summary-percent').text()).toBe('125% spent')
    expect(find('summary-meter').attributes('aria-valuenow')).toBe('100')
    expect(find('summary-meter').find('.v-progress-linear__determinate').classes()).toContain(
      'bg-error',
    )
    expect(find('summary-meter').attributes('aria-label')).toBe('125% of the budget spent')
    expect(find('summary-pace-note').text()).toContain('$1,750.00 over budget')
    expect(find('tile-net').find('[data-test="tile-value"]').text()).toBe('-$100.00')
  })

  it('says when it is close to the limit, or on pace to go over it', async () => {
    const close = await render(makePeriod({ spent: '1900.00', left: '100.00' }))
    expect(close.find('summary-status').text()).toBe('Close to the limit')
    expect(close.find('summary-meter').find('.v-progress-linear__determinate').classes()).toContain(
      'bg-warning',
    )

    const fast = await render(makePeriod({ projected: '2600.00' }))
    expect(fast.find('summary-status').text()).toBe('On pace to go over')
    expect(fast.find('summary-pace-note').text()).toContain('$600.00 over budget')
  })

  it('says when the pace is exactly on budget', async () => {
    const { find } = await render(makePeriod({ projected: '2000.00' }))

    expect(find('summary-pace-note').text()).toBe(
      "At this pace you'll spend $2,000.00, right on budget.",
    )
  })

  it('counts the days left in the period, down to the last', async () => {
    expect((await render(makePeriod({ days_gone: 29 }))).find('summary-time').text()).toBe(
      '1 day left',
    )
    expect((await render(makePeriod({ days_gone: 30 }))).find('summary-time').text()).toBe(
      'Last day',
    )
  })

  it('looks back at a period that is over, without a pace', async () => {
    const { find } = await render(
      makePeriod({ current: false, days_gone: 30, expected: null, projected: null }),
    )

    expect(find('summary-status').text()).toBe('Within budget')
    expect(find('summary-time').text()).toBe('Period over')
    expect(find('summary-pace').exists()).toBe(false)
    expect(find('summary-pace-note').exists()).toBe(false)
  })

  it('has nothing to say yet about a period that has not begun', async () => {
    const { find } = await render(
      makePeriod({
        current: false,
        days_gone: 0,
        expected: null,
        projected: null,
        spent: '0.00',
        income: '0.00',
        left: '2000.00',
        saved: '0.00',
      }),
    )

    expect(find('summary-status').exists()).toBe(false)
    expect(find('summary-time').text()).toBe('Not started yet')
    expect(find('summary-percent').text()).toBe('0% spent')
  })

  it('lets admins edit and delete the budget, and viewers do neither', async () => {
    const { wrapper, find } = await render()

    for (const action of ['budget-edit', 'budget-delete']) {
      await find('budget-actions').trigger('click')
      await flushPromises()
      await click(`.v-overlay--active [data-test="${action}"]`)
      await menuSettled()
    }

    expect(wrapper.emitted('edit')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect((await render(makePeriod(), true)).find('budget-actions').exists()).toBe(false)
  })

  it('does not show a pace when there is no amount to measure it against', async () => {
    const { find } = await render(makePeriod({ amount: '0.00', expected: '0.00' }))

    expect(find('summary-pace').exists()).toBe(false)
    expect(find('summary-percent').text()).toBe('0% spent')
  })
})
