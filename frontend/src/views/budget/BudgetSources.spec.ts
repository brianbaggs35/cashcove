import { makeSource } from '@/test/budgets'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import BudgetSources from '@/views/budget/BudgetSources.vue'

const sources = [
  makeSource({
    id: 'source-paycheck',
    kind: 'income',
    name: 'Paycheck',
    target_id: 'category-paycheck',
    amount: '2400.00',
    count: 1,
  }),
  makeSource(),
  makeSource({
    id: 'source-card',
    type: 'account',
    name: 'Rewards Visa',
    target_id: 'account-visa',
    amount: '0.00',
    count: 0,
  }),
  makeSource({
    id: 'source-rule',
    type: 'automation',
    name: 'Netflix rule',
    target_id: 'automation-netflix',
    active: false,
    amount: '15.49',
    count: 1,
  }),
  makeSource({
    id: 'source-gym',
    type: 'subscription',
    name: 'Gym',
    target_id: 'subscription-gym',
    amount: '30.00',
    count: 3,
  }),
  makeSource({
    id: 'source-gone',
    name: 'Old category',
    target_id: 'category-deleted',
    amount: '5.00',
    count: 1,
  }),
]

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(BudgetSources, {
    width: 1280,
    props: { sources, income: '2400.00', spent: '1250.00', readonly: false, ...props },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

const text = (element: { text: () => string }) => element.text().replace(/\s+/g, ' ')

describe('BudgetSources', () => {
  it('lists what counts as income and as spending, with what each counted', async () => {
    const { find } = await render()

    const income = find('sources-income')
    expect(text(income.find('h3'))).toBe('Income')
    expect(text(income)).toContain('$2,400.00 this period')
    expect(income.findAll('[data-test="budget-source"]').map(text)).toEqual([
      '💼Paycheck Category · $2,400.00 from 1 transaction',
    ])
    const spending = find('sources-spending')
    expect(text(spending)).toContain('$1,250.00 this period')
    expect(spending.findAll('[data-test="budget-source"]').map(text)).toEqual([
      '🛒Groceries Category · $124.12 from 2 transactions',
      'Rewards Visa Account · $0.00 from 0 transactions',
      'Netflix rule Paused Rule · $15.49 from 1 transaction',
      'Gym Subscription · $30.00 from 3 transactions',
      'Old category Category · $5.00 from 1 transaction',
    ])
  })

  it('marks the ones that are paused', async () => {
    const { wrapper } = await render()

    expect(wrapper.findAll('[data-test="source-paused"]')).toHaveLength(1)
  })

  it('adds income or spending, and stops counting a source', async () => {
    const { wrapper, find } = await render()

    await find('add-income').trigger('click')
    await find('add-spending').trigger('click')
    await wrapper.findAll('[data-test="source-remove"]')[1]!.trigger('click')

    expect(wrapper.emitted('add')).toEqual([['income'], ['spending']])
    expect(wrapper.emitted('remove')).toEqual([[sources[1]]])
    expect(wrapper.findAll('[data-test="source-remove"]')[0]!.attributes('aria-label')).toBe(
      'Stop counting Paycheck',
    )
  })

  it('says what to add when nothing counts yet', async () => {
    const { wrapper } = await render({ sources: [] })

    expect(wrapper.findAll('[data-test="sources-empty"]').map(text)).toEqual([
      'Nothing counts as income yet. Add your paycheck, or the account it goes into.',
      'Nothing counts as spending yet. Add the bills, subscriptions, accounts or categories you spend on.',
    ])
  })

  it('has no way to change what counts for viewers', async () => {
    const { wrapper } = await render({ readonly: true })

    expect(wrapper.find('[data-test="add-income"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="source-remove"]').exists()).toBe(false)
  })
})
