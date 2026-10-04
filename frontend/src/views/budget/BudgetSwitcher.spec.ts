import { mountWithPlugins } from '@/test/mount'
import { seedFinance } from '@/test/finance'
import { makeBudget } from '@/test/budgets'
import BudgetSwitcher from '@/views/budget/BudgetSwitcher.vue'

const monthly = makeBudget()
const weekly = makeBudget({
  id: 'budget-weekly',
  name: 'Spending money',
  period: 'weekly',
  current: {
    start: '2026-09-20',
    end: '2026-09-26',
    amount: '150.00',
    income: '0.00',
    spent: '180.50',
  },
})
const yearly = makeBudget({
  id: 'budget-yearly',
  name: 'Year',
  period: 'yearly',
  current: {
    start: '2026-01-01',
    end: '2026-12-31',
    amount: '1000.00',
    income: '0.00',
    spent: '950.00',
  },
})

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(BudgetSwitcher, {
    width: 1280,
    props: { budgets: [monthly, weekly, yearly], selected: monthly.id, canAdd: true, ...props },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('BudgetSwitcher', () => {
  it('shows each budget with how its period is going, and marks the one chosen', async () => {
    const { find, wrapper } = await render()

    expect(wrapper.findAll('[data-test="budget-card-name"]').map((name) => name.text())).toEqual([
      'Household',
      'Spending money',
      'Year',
    ])
    expect(find(`budget-card-${monthly.id}`).attributes('aria-pressed')).toBe('true')
    expect(find(`budget-card-${weekly.id}`).attributes('aria-pressed')).toBe('false')
    expect(find(`budget-card-${monthly.id}`).text()).toContain('Monthly')
    expect(find(`budget-card-${monthly.id}`).find('[data-test="budget-card-amount"]').text()).toBe(
      '$1,250.00 of $2,000.00',
    )
    expect(find(`budget-card-${monthly.id}`).find('[data-test="budget-card-left"]').text()).toBe(
      '$750.00 left',
    )
  })

  it('says when a budget is over, and when it is close to its amount', async () => {
    const { find } = await render()

    const over = find(`budget-card-${weekly.id}`).find('[data-test="budget-card-left"]')
    expect(over.text()).toBe('Over by $30.50')
    expect(over.classes()).toContain('text-error')
    const close = find(`budget-card-${yearly.id}`).find('[data-test="budget-card-left"]')
    expect(close.text()).toBe('$50.00 left')
    expect(close.classes()).not.toContain('text-error')
    expect(
      find(`budget-card-${monthly.id}`).findComponent({ name: 'VProgressLinear' }).props('color'),
    ).toBe('primary')
    expect(
      find(`budget-card-${yearly.id}`).findComponent({ name: 'VProgressLinear' }).props('color'),
    ).toBe('warning')
    expect(
      find(`budget-card-${weekly.id}`).findComponent({ name: 'VProgressLinear' }).props('color'),
    ).toBe('error')
  })

  it('chooses a budget, and offers a new one to admins', async () => {
    const { wrapper, find } = await render()

    await find(`budget-card-${weekly.id}`).trigger('click')
    await find('budget-add').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[weekly.id]])
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('has no way to add a budget for viewers', async () => {
    const { find } = await render({ canAdd: false })

    expect(find('budget-add').exists()).toBe(false)
  })
})
