import { VPie } from 'vuetify/labs/VPie'

import type { CategoryTotal } from '@/api/budget'
import { makeDashboard } from '@/test/dashboard'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import SpendingBreakdown from '@/views/dashboard/SpendingBreakdown.vue'

async function render(categories: CategoryTotal[] = makeDashboard().categories, width = 1280) {
  const { wrapper } = await mountWithPlugins(SpendingBreakdown, {
    width,
    props: { categories },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find }
}

describe('SpendingBreakdown', () => {
  it('names each category with what it took and its share, the biggest first', async () => {
    const { wrapper, find } = await render()

    const parts = wrapper.findAll('[data-test="spending-part"]').map((part) => part.text())
    expect(parts).toEqual([
      expect.stringMatching(/^🛒\s*Groceries\s*\$700\.00\s*56%$/),
      expect.stringMatching(/^☕\s*Coffee\s*\$350\.00\s*28%$/),
      expect.stringMatching(/^Uncategorized\s*\$200\.00\s*16%$/),
    ])
    expect(find('spending-total').text()).toBe('$1,250.00')
  })

  it('draws the ring in the same colours as the list', async () => {
    const { wrapper } = await render()

    const pie = wrapper.findComponent(VPie)
    expect(pie.props('items')).toEqual([
      { key: 'category-groceries', title: 'Groceries', value: 70000, color: 'var(--chart-cat-1)' },
      { key: 'category-coffee', title: 'Coffee', value: 35000, color: 'var(--chart-cat-2)' },
      { key: 'none', title: 'Uncategorized', value: 20000, color: 'var(--chart-cat-3)' },
    ])
    const keys = wrapper.findAll('.spend__key').map((key) => key.attributes('style'))
    expect(keys[0]).toContain('var(--chart-cat-1)')
  })

  it('counts the categories past the biggest few together', async () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id, index) => ({
      category_id: id,
      amount: `${70 - index * 10}.00`,
      count: 1,
    }))

    const { wrapper } = await render(many)

    const parts = wrapper.findAll('[data-test="spending-part"]').map((part) => part.text())
    expect(parts).toHaveLength(6)
    expect(parts[5]).toMatch(/^Everything else\s*\$30\.00\s*11%$/)
  })

  it('shows the same numbers as a table', async () => {
    const { wrapper, find } = await render()

    await find('chart-view-table').trigger('click')

    const rows = wrapper.findAll('[data-test="spending-row"]').map((row) => row.text())
    expect(rows).toEqual([
      expect.stringMatching(/^Groceries\s*\$700\.00\s*56%\s*6$/),
      expect.stringMatching(/^Coffee\s*\$350\.00\s*28%\s*12$/),
      expect.stringMatching(/^Uncategorized\s*\$200\.00\s*16%\s*3$/),
    ])
  })

  it('fits its table on a phone by putting the count under the category', async () => {
    const { wrapper, find } = await render(
      [
        { category_id: 'category-groceries', amount: '700.00', count: 6 },
        { category_id: 'category-coffee', amount: '350.00', count: 1 },
      ],
      390,
    )

    await find('chart-view-table').trigger('click')

    expect(wrapper.findAll('thead th').map((heading) => heading.text())).toEqual([
      'Category',
      'Spent',
      'Share',
    ])
    expect(wrapper.findAll('[data-test="spending-more"]').map((more) => more.text())).toEqual([
      '6 transactions',
      '1 transaction',
    ])
  })

  it('has no ring until money has gone out', async () => {
    const { find } = await render([])

    expect(find('spending-chart').exists()).toBe(false)
    expect(find('empty-state').text()).toContain('No spending yet this month')
  })

  it('keeps the ring from the screen readers, which have the list', async () => {
    const { wrapper } = await render()

    expect(wrapper.find('.spend__ring').attributes('aria-hidden')).toBe('true')
  })
})
