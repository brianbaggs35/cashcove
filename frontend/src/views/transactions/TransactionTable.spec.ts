import { flushPromises } from '@vue/test-utils'
import { VDataTableServer } from 'vuetify/components'

import type { Transaction } from '@/api/transactions'
import { latte, makeTransaction, salary, seedFinance, wholeFoods } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import TransactionTable from '@/views/transactions/TransactionTable.vue'

const noted = makeTransaction({
  id: 'transaction-noted',
  account_id: 'account-gone',
  date: '2025-12-31',
  amount: '-20.00',
  payee: 'Corner store',
  category_id: null,
  notes: 'Snacks for the trip',
})

// Imported from a file that named it the way it's shown.
const imported = makeTransaction({
  id: 'transaction-imported',
  date: '2025-12-30',
  amount: '-15.49',
  payee: 'NETFLIX.COM',
  original_description: 'Netflix.com',
  source: 'file',
})

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(TransactionTable, {
    width: 1280,
    props: {
      items: [latte, wholeFoods, salary, noted],
      total: 120,
      loading: false,
      sort: '-date',
      page: 1,
      pageSize: 50,
      selectable: true,
      selected: [],
      ...props,
    },
    beforeMount: () => seedFinance(),
  })
  const { wrapper } = mounted
  const rows = () => wrapper.findAll('tbody tr')
  const header = (title: string) =>
    wrapper.findAll('thead th').find((cell) => cell.text().includes(title))!
  const options = () => wrapper.emitted('options') ?? []
  return { ...mounted, rows, header, options }
}

describe('TransactionTable', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 8, 19, 12), toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows each transaction with its category, account and signed amount', async () => {
    const { wrapper, rows } = await render({ items: [latte, wholeFoods, salary, noted, imported] })

    expect(wrapper.findAll('[data-test="transaction-row"]')).toHaveLength(5)
    expect(wrapper.findAll('thead th').map((cell) => cell.text())).toEqual([
      '',
      'Date',
      'Payee',
      'Category',
      'Account',
      'Amount',
      'Actions',
    ])
    const cells = (row: number) =>
      rows()
        [row]!.findAll('td')
        .map((cell) => cell.text())
    expect(cells(0).slice(1)).toEqual([
      'Sep 19',
      'Blue BottlePendingBLUE BOTTLE COFFEE #12',
      '☕Coffee',
      'Rewards Visa',
      '-$4.50',
      '',
    ])
    expect(cells(2)[5]).toBe('+$2,400.00')
    expect(cells(3).slice(1, 5)).toEqual([
      'Dec 31, 2025',
      'Corner storeSnacks for the trip',
      'Uncategorized',
      'Deleted account',
    ])
    // What the bank calls it goes unsaid when it's the payee.
    expect(cells(4)[2]).toBe('NETFLIX.COM')
    expect(rows()[0]!.find('.money').classes()).toContain('text-medium-emphasis')
    expect(rows()[1]!.find('.money').classes()).not.toContain('text-medium-emphasis')
    expect(wrapper.find('[data-test="transaction-open"]').attributes('aria-label')).toBe(
      'Edit Blue Bottle',
    )
  })

  it('opens a transaction from its row or its button', async () => {
    const { wrapper, rows } = await render()
    await rows()[1]!.trigger('click')
    await rows()[2]!.find('[data-test="transaction-open"]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([[wholeFoods], [salary]])
  })

  it('lets admins select transactions', async () => {
    const { wrapper, rows } = await render()
    await rows()[0]!.find('input[type="checkbox"]').trigger('click')
    expect(wrapper.emitted('update:selected')).toEqual([[[latte.id]]])
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('marks the page as partly selected, and selects or clears all of it', async () => {
    const { wrapper } = await render({ selected: [latte.id] })
    const all = () => wrapper.find('[data-test="transaction-select-page"] input')
    const box = () => all().element as HTMLInputElement
    expect(all().attributes('aria-label')).toBe('Select all on this page')
    expect(all().attributes('aria-checked')).toBe('mixed')
    expect(box().indeterminate).toBe(true)

    await all().trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([
      [latte.id, wholeFoods.id, salary.id, noted.id],
    ])

    await wrapper.setProps({ selected: [latte.id, wholeFoods.id, salary.id, noted.id] })
    expect(box().indeterminate).toBe(false)
    expect(box().checked).toBe(true)
    await all().trigger('click')
    expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([[]])
  })

  it('shows viewers the details without ways to select', async () => {
    const { wrapper } = await render({ selectable: false })
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="transaction-open"]').attributes('aria-label')).toBe(
      'See Blue Bottle',
    )
  })

  it('sorts by a column from the first page', async () => {
    const { header, options, wrapper } = await render({ page: 2 })
    await header('Amount').find('.v-data-table-header__content').trigger('click')
    await flushPromises()
    expect(options()).toEqual([[{ page: 1, pageSize: 50, sort: 'amount' }]])

    await wrapper.setProps({ sort: 'amount', page: 1 })
    await flushPromises()
    await header('Amount').find('.v-data-table-header__content').trigger('click')
    await flushPromises()
    expect(options().at(-1)).toEqual([{ page: 1, pageSize: 50, sort: '-amount' }])
    expect(options()).toHaveLength(2)
  })

  it('turns the page and changes how many show on each', async () => {
    const { wrapper, options } = await render()
    await wrapper.find('button[aria-label="Next page"]').trigger('click')
    await flushPromises()
    expect(options()).toEqual([[{ page: 2, pageSize: 50, sort: '-date' }]])

    await wrapper.setProps({ page: 2 })
    await flushPromises()
    expect(options()).toHaveLength(1)

    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 100)
    await flushPromises()
    expect(options().at(-1)).toEqual([{ page: 1, pageSize: 100, sort: '-date' }])
  })

  it('falls back to newest first without an order', async () => {
    const { wrapper, options } = await render({ sort: 'payee' })
    wrapper
      .findComponent(VDataTableServer)
      .vm.$emit('update:options', { page: 1, itemsPerPage: 50, sortBy: [] })
    expect(options()).toEqual([[{ page: 1, pageSize: 50, sort: '-date' }]])
  })

  it('shows its progress while loading', async () => {
    const { wrapper } = await render({ loading: true, items: [] as Transaction[] })
    expect(wrapper.find('.v-data-table-progress').exists()).toBe(true)
  })
})
