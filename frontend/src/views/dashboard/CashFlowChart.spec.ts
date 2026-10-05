import { makeDashboard, makeMonth } from '@/test/dashboard'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import CashFlowChart from '@/views/dashboard/CashFlowChart.vue'

async function render(months = makeDashboard().months, width = 1280) {
  const { wrapper } = await mountWithPlugins(CashFlowChart, {
    width,
    props: { months },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find }
}

describe('CashFlowChart', () => {
  it('draws income and spending for each month, one chart on top of the other', async () => {
    const { wrapper, find } = await render()

    expect(find('cash-flow-chart').exists()).toBe(true)
    expect(wrapper.findAll('.flow__layer')).toHaveLength(2)
    expect(wrapper.findAll('.flow__layer svg')).toHaveLength(2)
    // Each month in the chart's own bars: four slots across, the second and third used.
    const [income, spent] = wrapper.findAll('.flow__layer svg')
    expect(income!.findAll('clipPath rect')).toHaveLength(24)
    expect(spent!.findAll('clipPath rect')).toHaveLength(24)
    expect(wrapper.find('.flow__labels').text()).toBe('AprMayJunJulAugSep')
  })

  it('has an axis in round amounts', async () => {
    const { wrapper } = await render()

    expect(wrapper.find('.flow__axis').text()).toBe('$0$1K$2K$3K')
  })

  it('says what each month came to for anyone who cannot see the bars', async () => {
    const { wrapper } = await render()

    const months = wrapper.findAll('[data-test="cash-flow-month"]')
    expect(months).toHaveLength(6)
    expect(months[5]!.attributes('aria-label')).toBe(
      'September 2026: income $2,400.00, spent $1,250.00, saved +$1,150.00',
    )
    expect(months[2]!.attributes('aria-label')).toBe(
      'June 2026: income $2,300.00, spent $2,450.00, overspent -$150.00',
    )
  })

  it('shows what a month came to beside it when it is pointed at or tabbed to', async () => {
    const { wrapper, find } = await render()
    const months = wrapper.findAll('[data-test="cash-flow-month"]')
    expect(find('cash-flow-tip').exists()).toBe(false)

    await months[5]!.trigger('pointerenter')
    expect(find('cash-flow-tip').text()).toContain('September 2026')
    expect(find('cash-flow-tip').text()).toContain('$2,400.00')
    expect(find('cash-flow-tip').text()).toContain('$1,250.00')
    expect(find('cash-flow-tip').text()).toContain('Saved +$1,150.00')
    // Held to the right edge, where it would otherwise leave the chart.
    expect(find('cash-flow-tip').attributes('style')).toContain('translateX(-100%)')

    await months[5]!.trigger('pointerleave')
    expect(find('cash-flow-tip').exists()).toBe(false)

    await months[0]!.trigger('focus')
    expect(find('cash-flow-tip').text()).toContain('April 2026')
    expect(find('cash-flow-tip').attributes('style')).toContain('translateX(0)')
    // Which the screen readers have, in each month's name.
    expect(find('cash-flow-tip').attributes('aria-hidden')).toBe('true')

    await months[0]!.trigger('blur')
    expect(find('cash-flow-tip').exists()).toBe(false)
    await months[2]!.trigger('focus')
    expect(find('cash-flow-tip').attributes('style')).toContain('translateX(-50%)')
  })

  it('shows the same numbers as a table', async () => {
    const { wrapper, find } = await render()

    await find('chart-view-table').trigger('click')

    const rows = wrapper.findAll('[data-test="cash-flow-row"]').map((row) => row.text())
    expect(rows).toHaveLength(6)
    expect(rows[5]).toMatch(/^September 2026\s*\$2,400\.00\s*\$1,250\.00\s*\+\$1,150\.00$/)
    expect(rows[2]).toMatch(/^June 2026\s*\$2,300\.00\s*\$2,450\.00\s*-\$150\.00$/)
  })

  it('fits its table on a phone by putting the income under the month', async () => {
    const { wrapper, find } = await render(makeDashboard().months, 390)

    await find('chart-view-table').trigger('click')

    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Month',
      'Spent',
      'Left over',
    ])
    const rows = wrapper.findAll('[data-test="cash-flow-row"]').map((row) => row.text())
    expect(rows[5]).toMatch(/^September 2026\s*Income \$2,400\.00\s*\$1,250\.00\s*\+\$1,150\.00$/)
    expect(wrapper.findAll('[data-test="cash-flow-more"]')).toHaveLength(6)
  })

  it('has nothing to compare until there are transactions', async () => {
    const empty = makeDashboard().months.map((month) =>
      makeMonth({ start: month.start, end: month.end, income: '0.00', spent: '0.00' }),
    )

    const { find } = await render(empty)

    expect(find('cash-flow-chart').exists()).toBe(false)
    expect(find('empty-state').text()).toContain('Nothing to compare yet')
  })

  it('draws a bar only for what was more than nothing, whichever way a month ended', async () => {
    const { wrapper } = await render([
      makeMonth({ income: '0.00', spent: '50.00' }),
      makeMonth({ start: '2026-10-01', end: '2026-10-31', income: '70.00', spent: '0.00' }),
    ])

    expect(wrapper.find('[data-test="cash-flow-chart"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="cash-flow-month"]')).toHaveLength(2)
  })
})
