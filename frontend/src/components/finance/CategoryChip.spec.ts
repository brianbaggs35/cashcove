import CategoryChip from '@/components/finance/CategoryChip.vue'
import { coffee, paycheck, seedFinance, transfers } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(categoryId: string | null, size?: string) {
  const { wrapper } = await mountWithPlugins(CategoryChip, {
    props: { categoryId, size },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('CategoryChip', () => {
  it('shows the emoji and name, colored by kind', async () => {
    const spending = await render(coffee.id)
    expect(spending.text()).toBe('☕Coffee')
    expect(spending.classes().some((name) => name.startsWith('text-'))).toBe(false)
    expect(spending.classes()).toContain('v-chip--size-small')

    expect((await render(paycheck.id, 'x-small')).classes()).toContain('text-success')
    expect((await render(transfers.id)).classes()).toContain('text-info')
  })

  it('says when there is no category', async () => {
    for (const id of [null, 'category-gone']) {
      const wrapper = await render(id)
      expect(wrapper.text()).toBe('Uncategorized')
      expect(wrapper.classes()).toContain('category-chip--none')
    }
  })
})
