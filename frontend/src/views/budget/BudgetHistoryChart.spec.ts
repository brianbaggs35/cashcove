import type { HistoryPeriod } from '@/api/budget'
import { makeHistory } from '@/test/budgets'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import BudgetHistoryChart from '@/views/budget/BudgetHistoryChart.vue'

async function render(periods: HistoryPeriod[] = makeHistory(), width = 1280) {
  const mounted = await mountWithPlugins(BudgetHistoryChart, {
    width,
    props: {
      history: { periods, converted: [], unavailable: [] },
      kind: 'monthly',
      selected: '2026-09-01',
    },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const periodsShown = () => mounted.wrapper.findAll('[data-test="history-period"]')
  return { ...mounted, find, periodsShown }
}

const text = (element: { text: () => string }) => element.text().replace(/\s+/g, ' ')

/** `count` months ending in September 2026, each spending a little more than the last. */
function months(count: number): HistoryPeriod[] {
  return Array.from({ length: count }, (_, index) => {
    const first = new Date(2026, 8 - (count - 1 - index), 1)
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    const iso = (date: Date) =>
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    return {
      start: iso(first),
      end: iso(last),
      amount: '2000.00',
      income: '2400.00',
      spent: `${1000 + index * 10}.00`,
      current: index === count - 1,
    }
  })
}

describe('BudgetHistoryChart', () => {
  it('draws income and spending for each period, and which one is being looked at', async () => {
    const { wrapper, periodsShown } = await render()

    expect(wrapper.findAll('.hist__label').map(text)).toEqual(['Jul', 'Aug', 'Sep'])
    expect(wrapper.findAll('.hist__grid text').map(text)).toEqual(['$0', '$1K', '$2K', '$3K'])
    expect(wrapper.findAll('.hist__bar--income')).toHaveLength(3)
    expect(wrapper.findAll('.hist__bar--spent')).toHaveLength(3)
    expect(wrapper.findAll('.hist__budget')).toHaveLength(3)
    expect(wrapper.findAll('.hist__selected')).toHaveLength(1)
    expect(periodsShown().map((period) => period.attributes('aria-current'))).toEqual([
      undefined,
      undefined,
      'true',
    ])
    expect(periodsShown()[1]!.attributes('aria-label')).toBe(
      'August 2026: income $2,400.00, spent $2,150.00, budget $2,000.00',
    )
    expect(wrapper.find('[data-test="chart-legend"]').text().replace(/\s+/g, ' ')).toBe(
      'Income Spent Budget',
    )
  })

  it('is narrower on a phone', async () => {
    const { wrapper } = await render(makeHistory(), 400)

    expect(wrapper.find('.hist__svg').attributes('viewBox')).toBe('0 0 340 240')
  })

  it('names the periods as a group', async () => {
    const { wrapper } = await render()

    const group = wrapper.find('fieldset')
    expect(group.attributes('aria-label')).toBe('Periods')
    expect(group.findAll('[data-test="history-period"]')).toHaveLength(3)
  })

  it('chooses a period by clicking it or with the keyboard', async () => {
    const { wrapper, periodsShown } = await render()

    await periodsShown()[0]!.trigger('click')
    await periodsShown()[1]!.trigger('keydown', { key: 'Enter' })
    await periodsShown()[2]!.trigger('keydown', { key: ' ' })
    await periodsShown()[2]!.trigger('keydown', { key: 'a' })

    expect(wrapper.emitted('select')).toEqual([['2026-07-01'], ['2026-08-01'], ['2026-09-01']])
  })

  it('reads a period when it is pointed at or focused, and stops when it is not', async () => {
    const { find, periodsShown } = await render()

    await periodsShown()[0]!.trigger('pointerenter')
    expect(text(find('history-tip'))).toBe(
      'July 2026$2,400.00income$1,800.00spent Budget $2,000.00 · Under budget by $200.00',
    )
    await periodsShown()[0]!.trigger('pointerleave')
    expect(find('history-tip').exists()).toBe(false)

    await periodsShown()[1]!.trigger('focus')
    expect(text(find('history-tip'))).toContain('August 2026')
    expect(text(find('history-tip'))).toContain('Over budget by $150.00')
    await periodsShown()[1]!.trigger('blur')
    expect(find('history-tip').exists()).toBe(false)
  })

  it('keeps the reading on the chart at either edge', async () => {
    const { find, periodsShown } = await render(months(6))

    await periodsShown()[0]!.trigger('pointerenter')
    expect(find('history-tip').attributes('style')).toContain('translateX(0)')
    await periodsShown()[3]!.trigger('pointerenter')
    expect(find('history-tip').attributes('style')).toContain('translateX(-50%)')
    await periodsShown()[5]!.trigger('pointerenter')
    expect(find('history-tip').attributes('style')).toContain('translateX(-100%)')
  })

  it('labels only every other period when there are too many to fit', async () => {
    const { wrapper } = await render(months(24))

    expect(wrapper.findAll('.hist__label')).toHaveLength(12)
    expect(wrapper.findAll('[data-test="history-period"]')).toHaveLength(24)
  })

  it('draws no bar for a period with no income, or with money back in place of spending', async () => {
    const { wrapper } = await render([{ ...makeHistory()[0]!, income: '0.00', spent: '-25.00' }])

    expect(wrapper.findAll('.hist__bar--income')).toHaveLength(0)
    expect(wrapper.findAll('.hist__bar--spent')).toHaveLength(0)
    expect(wrapper.findAll('.hist__budget')).toHaveLength(1)
  })

  it('has the same numbers as a table', async () => {
    const { find, wrapper } = await render()

    await find('chart-view-table').trigger('click')

    expect(
      wrapper
        .findAll('[data-test="history-row"]')
        .map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['July 2026', '$2,400.00', '$1,800.00', '$2,000.00', '+$200.00'],
      ['August 2026', '$2,400.00', '$2,150.00', '$2,000.00', '-$150.00'],
      ['September 2026', '$2,400.00', '$1,250.00', '$2,000.00', '+$750.00'],
    ])
    expect(wrapper.findAll('thead th').map(text)).toEqual([
      'Period',
      'Income',
      'Spent',
      'Budget',
      'Left',
    ])
    expect(find('history-more').exists()).toBe(false)
  })

  it('fits its table on a phone by putting income and budget under the period', async () => {
    const { find, wrapper } = await render(makeHistory(), 400)

    await find('chart-view-table').trigger('click')

    expect(wrapper.findAll('thead th').map(text)).toEqual(['Period', 'Spent', 'Left'])
    expect(
      wrapper.findAll('[data-test="history-row"]').map((row) => row.findAll('th, td').map(text)),
    ).toEqual([
      ['July 2026 Income $2,400.00 · Budget $2,000.00', '$1,800.00', '+$200.00'],
      ['August 2026 Income $2,400.00 · Budget $2,000.00', '$2,150.00', '-$150.00'],
      ['September 2026 Income $2,400.00 · Budget $2,000.00', '$1,250.00', '+$750.00'],
    ])
  })
})
