import { latte, salary, seedFinance, wholeFoods, makeTransaction } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import RecentTransactions from '@/views/dashboard/RecentTransactions.vue'
import type { Transaction } from '@/api/transactions'

async function render(transactions: Transaction[]) {
  const { wrapper } = await mountWithPlugins(RecentTransactions, {
    width: 1280,
    props: { transactions },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('RecentTransactions', () => {
  it('lists each with its date, account, category and amount', async () => {
    const wrapper = await render([latte, wholeFoods, salary])

    const rows = wrapper.findAll('[data-test="recent-transaction"]').map((row) => row.text())
    expect(rows).toEqual([
      'Blue BottleSep 19, 2026 · Rewards Visa☕Coffee-$4.50',
      'Whole FoodsSep 18, 2026 · Everyday checking🛒Groceries-$84.12',
      'Acme CorpSep 15, 2026 · Everyday checking💼Paycheck+$2,400.00',
    ])
  })

  it('shows what has no category as uncategorized', async () => {
    const wrapper = await render([makeTransaction({ category_id: null })])

    expect(wrapper.find('[data-test="recent-transaction"]').text()).toContain('Uncategorized')
  })

  it('still lists one from an account it does not know', async () => {
    const wrapper = await render([makeTransaction({ account_id: 'account-gone' })])

    const text = wrapper.find('[data-test="recent-transaction"]').text()
    expect(text).toContain('Whole Foods')
    expect(text).not.toContain(' · ')
  })

  it('links to every transaction from its corner', async () => {
    const wrapper = await render([wholeFoods])

    expect(wrapper.find('[data-test="dashboard-card-link"]').attributes('href')).toBe(
      '/transactions',
    )
  })

  it('suggests importing or connecting when there are none', async () => {
    const wrapper = await render([])

    expect(wrapper.find('[data-test="empty-state"]').text()).toContain('No transactions yet')
    expect(wrapper.find('[data-test="recent-import"]').attributes('href')).toBe('/import')
    expect(wrapper.find('[data-test="recent-connect"]').attributes('href')).toBe('/connect')
    expect(wrapper.find('[data-test="dashboard-card-link"]').exists()).toBe(false)
  })
})
