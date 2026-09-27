import type { Transaction } from '@/api/transactions'
import { latte, makeTransaction, salary, seedFinance, wholeFoods } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import TransactionList from '@/views/transactions/TransactionList.vue'

const mystery = makeTransaction({
  id: 'transaction-mystery',
  account_id: 'account-gone',
  date: '2026-09-15',
  amount: '12.00',
  payee: 'Venmo',
  category_id: null,
})

async function render(items: Transaction[], byDay = true) {
  const { wrapper } = await mountWithPlugins(TransactionList, {
    props: { items, byDay },
    beforeMount: () => seedFinance(),
  })
  const rows = () => wrapper.findAll('[data-test="transaction-item"]')
  return { wrapper, rows }
}

describe('TransactionList', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 8, 19, 12), toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lists transactions under the day they happened', async () => {
    const { wrapper, rows } = await render([latte, wholeFoods, salary, mystery])

    expect(wrapper.findAll('[data-test="transaction-day"]').map((day) => day.text())).toEqual([
      'Today',
      'Yesterday',
      'Tuesday, September 15',
    ])
    const [first, second, , last] = rows()
    expect(first!.text()).toContain('Blue Bottle')
    expect(first!.text()).toContain('Pending')
    expect(first!.text()).toContain('Coffee · Rewards Visa')
    expect(first!.text()).toContain('-$4.50')
    expect(first!.find('.v-avatar').text()).toBe('☕')
    expect(second!.text()).toContain('Groceries · Everyday checking')
    expect(second!.text()).not.toContain('Pending')
    expect(last!.text()).toContain('Uncategorized')
    expect(last!.text()).toContain('+$12.00')
    expect(last!.find('.v-avatar .v-icon').exists()).toBe(true)
  })

  it('shows the date on each transaction when in another order', async () => {
    const { wrapper, rows } = await render([salary, latte], false)
    expect(wrapper.find('[data-test="transaction-day"]').exists()).toBe(false)
    expect(rows()[0]!.text()).toContain('Sep 15 · Paycheck · Everyday checking')
  })

  it('opens a transaction', async () => {
    const { wrapper, rows } = await render([latte, wholeFoods])
    await rows()[1]!.trigger('click')
    expect(wrapper.emitted('open')).toEqual([[wholeFoods]])
  })
})
