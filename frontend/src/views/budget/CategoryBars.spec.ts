import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import CategoryBars from '@/views/budget/CategoryBars.vue'

async function render(categories: { category_id: string | null; amount: string; count: number }[]) {
  const mounted = await mountWithPlugins(CategoryBars, {
    width: 1280,
    props: { categories },
    beforeMount: () => seedFinance(),
  })
  return mounted.wrapper
}

const text = (element: { text: () => string }) => element.text().replace(/\s+/g, ' ')
const row = (element: { find: (selector: string) => { text: () => string } }) =>
  ['name', 'amount', 'share'].map((part) =>
    text(element.find(`[data-test="category-bar-${part}"]`)),
  )

describe('CategoryBars', () => {
  it('shows what was spent in each category with its share of the total', async () => {
    const wrapper = await render([
      { category_id: 'category-groceries', amount: '300.00', count: 3 },
      { category_id: 'category-coffee', amount: '100.00', count: 5 },
      { category_id: null, amount: '100.00', count: 1 },
    ])

    const rows = wrapper.findAll('[data-test="category-bar"]')
    expect(rows.map(row)).toEqual([
      ['🛒 Groceries', '$300.00', '60%'],
      ['☕ Coffee', '$100.00', '20%'],
      ['Uncategorized', '$100.00', '20%'],
    ])
    expect(rows[0]!.find('.category-bars__bar').attributes('style')).toContain('width: 100%')
    expect(rows[1]!.find('.category-bars__bar').attributes('style')).toContain(
      'width: 33.33333333333333%',
    )
  })

  it('counts the categories past the first six together', async () => {
    const wrapper = await render(
      Array.from({ length: 9 }, (_, index) => ({
        category_id: null,
        amount: `${90 - index * 10}.00`,
        count: 1,
      })),
    )

    const rows = wrapper.findAll('[data-test="category-bar"]')
    expect(rows).toHaveLength(7)
    expect(row(rows[6]!)).toEqual(['Everything else', '$60.00', '13%'])
  })
})
