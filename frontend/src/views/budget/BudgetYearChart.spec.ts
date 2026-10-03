import { mountWithPlugins } from '@/test/mount'
import BudgetYearChart from '@/views/budget/BudgetYearChart.vue'

describe('BudgetYearChart', () => {
  const budgetYear = {
    year: 2026,
    start: '2026-01',
    end: '2026-12',
    currency: 'USD',
    income: { budgeted: '0.00', actual: '0.00' },
    spending: { budgeted: '600.00', actual: '240.00' },
    months: Array.from({ length: 12 }, (_, index) => {
      const month = String(index + 1).padStart(2, '0')
      return {
        month: `2026-${month}`,
        income: { budgeted: '0.00', actual: '0.00' },
        spending: {
          budgeted: index === 0 ? '100.00' : '50.00',
          actual: index === 0 ? '75.00' : '0.00',
        },
      }
    }),
  }

  it('plots the selected budget month against actual spending', async () => {
    const { wrapper } = await mountWithPlugins(BudgetYearChart, {
      props: { budgetYear, selectedMonth: '2026-01' },
    })
    expect(wrapper.findAll('[data-test^="chart-month-"]')).toHaveLength(12)
    expect(wrapper.find('[data-test="budget-year-chart"]').find('figcaption').text()).toContain(
      '2026',
    )
    expect(wrapper.find('[data-test="chart-month-2026-01"]').attributes('aria-label')).toContain(
      '$75.00 spent',
    )
    expect(wrapper.find('[data-test="chart-month-2026-01"]').classes()).toContain(
      'budget-chart__month--selected',
    )
    expect(wrapper.findAll('.budget-chart__bar--actual')[0]!.attributes('style')).toContain(
      'height: 75%',
    )
    wrapper.unmount()
  })

  it('keeps an all-zero year at a zero-height baseline', async () => {
    const emptyYear = {
      ...budgetYear,
      months: budgetYear.months.map((month) => ({
        ...month,
        spending: { budgeted: '0.00', actual: '0.00' },
      })),
    }
    const { wrapper } = await mountWithPlugins(BudgetYearChart, {
      props: { budgetYear: emptyYear, selectedMonth: '2026-04' },
    })
    expect(wrapper.findAll('.budget-chart__bar')[0]!.attributes('style')).toContain('0%')
    expect(wrapper.find('[data-test="chart-month-2026-04"]').classes()).toContain(
      'budget-chart__month--selected',
    )
    wrapper.unmount()
  })
})
