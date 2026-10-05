import type { Budget } from '@/api/budget'
import { useBudgetsStore } from '@/stores/budgets'
import { makeBudget } from '@/test/budgets'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import BudgetProgress from '@/views/dashboard/BudgetProgress.vue'

const weekly = makeBudget({
  id: 'budget-weekly',
  name: 'Spending money',
  period: 'weekly',
  current: {
    start: '2026-09-20',
    end: '2026-09-26',
    amount: '150.00',
    income: '0.00',
    spent: '40.00',
  },
})
const near = makeBudget({
  id: 'budget-near',
  name: 'Eating out',
  current: {
    start: '2026-09-01',
    end: '2026-09-30',
    amount: '200.00',
    income: '0.00',
    spent: '190.00',
  },
})
const over = makeBudget({
  id: 'budget-over',
  name: 'Fun',
  current: {
    start: '2026-09-01',
    end: '2026-09-30',
    amount: '100.00',
    income: '0.00',
    spent: '130.00',
  },
})

async function render(budgets: Budget[], role: 'admin' | 'viewer' = 'admin') {
  const { wrapper } = await mountWithPlugins(BudgetProgress, {
    width: 1280,
    props: { budgets },
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance()
      useBudgetsStore().budgets = budgets
    },
  })
  const rows = () => wrapper.findAll('[data-test="budget-progress-row"]')
  return { wrapper, rows }
}

describe('BudgetProgress', () => {
  it('shows how much of each budget is spent and what is left', async () => {
    const { rows } = await render([makeBudget(), weekly])

    expect(rows().map((row) => row.text())).toEqual([
      expect.stringMatching(
        /^Household\s*Monthly\s*\$750\.00 left\s*\$1,250\.00 of \$2,000\.00 · 63%$/,
      ),
      expect.stringMatching(
        /^Spending money\s*Weekly\s*\$110\.00 left\s*\$40\.00 of \$150\.00 · 27%$/,
      ),
    ])
    const meter = rows()[0]!.find('[role="progressbar"][aria-label]')
    expect(meter.attributes('aria-label')).toBe('Household: 63% spent')
    expect(meter.attributes('aria-valuenow')).toBe('63')
  })

  it('links each budget to its own page', async () => {
    const { rows } = await render([makeBudget(), weekly])

    expect(rows()[1]!.find('[data-test="budget-progress-link"]').attributes('href')).toBe(
      '/budget?budget=budget-weekly',
    )
  })

  it('warns when a budget is close to its amount, and when it is over', async () => {
    const { rows } = await render([near, over])

    const bar = (index: number) => rows()[index]!.find('.v-progress-linear__determinate')
    expect(bar(0).classes()).toContain('bg-warning')
    expect(bar(1).classes()).toContain('bg-error')
    expect(rows()[1]!.find('[data-test="budget-progress-left"]').text()).toBe('$30.00 over')
    expect(rows()[1]!.find('[data-test="budget-progress-left"]').classes()).toContain('text-error')
    expect(rows()[0]!.find('[data-test="budget-progress-left"]').classes()).not.toContain(
      'text-error',
    )
    // Never wider than the bar, however far over it is.
    expect(bar(1).attributes('style')).toContain('width: 100%')
  })

  it('lists the first few and says how many more there are', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) =>
      makeBudget({ id, name: `Budget ${id}` }),
    )

    const { wrapper, rows } = await render(many)

    expect(rows()).toHaveLength(4)
    expect(wrapper.find('[data-test="budget-progress-more"]').text()).toBe(
      'And 2 more in the Budget tab.',
    )
    const few = await render([makeBudget()])
    expect(few.wrapper.find('[data-test="budget-progress-more"]').exists()).toBe(false)
  })

  it('links to the Budget tab from its corner', async () => {
    const { wrapper } = await render([makeBudget()])

    expect(wrapper.find('[data-test="dashboard-card-link"]').attributes('href')).toBe('/budget')
  })

  it('invites an admin to make a budget', async () => {
    const { wrapper } = await render([])

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('No budgets yet')
    expect(wrapper.find('[data-test="budget-progress-add"]').attributes('href')).toBe('/budget')
    expect(wrapper.find('[data-test="dashboard-card-link"]').exists()).toBe(false)
  })

  it('tells a viewer an admin has to', async () => {
    const { wrapper } = await render([], 'viewer')

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain(
      "An admin hasn't made a budget yet.",
    )
    expect(wrapper.find('[data-test="budget-progress-add"]').exists()).toBe(false)
  })
})
