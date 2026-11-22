import { flushPromises } from '@vue/test-utils'
import { defineComponent, h } from 'vue'

import * as categoriesApi from '@/api/categories'
import CategoryButton from '@/components/finance/CategoryButton.vue'
import { useCategoriesStore } from '@/stores/categories'
import { click, page } from '@/test/dom'
import { coffee, groceries, makeGroups, paycheck, seedFinance, transfers } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(
  categoryId: string | null = groceries.id,
  props: Record<string, unknown> = {},
) {
  const mounted = await mountWithPlugins(CategoryButton, {
    props: { categoryId, subject: 'Whole Foods', ...props },
    beforeMount: () => seedFinance(),
  })
  const button = () => mounted.wrapper.find('[data-test="category-button"]')
  const open = async () => {
    await button().trigger('click')
    await flushPromises()
  }
  const options = () =>
    page()
      .findAll('[data-test^="category-option-"]')
      .map((option) => option.text())
  return { ...mounted, button, open, options }
}

describe('CategoryButton', () => {
  it('looks like the category’s chip, and says what pressing it does', async () => {
    const { wrapper, button } = await render()

    expect(button().element.tagName).toBe('BUTTON')
    expect(button().find('[data-test="category-chip"]').text()).toContain('Groceries')
    expect(button().attributes('aria-label')).toBe(
      'Change the category of Whole Foods, now Groceries',
    )
    expect(wrapper.find('[data-test="category-menu"]').exists()).toBe(false)
  })

  it('says when there is no category to change from', async () => {
    const { button } = await render(null)

    expect(button().find('[data-test="category-chip"]').text()).toContain('Uncategorized')
    expect(button().attributes('aria-label')).toBe(
      'Change the category of Whole Foods, now uncategorized',
    )
  })

  it('lists every category under its group, with the one it has marked', async () => {
    const { open, options } = await render()
    await open()

    expect(page().find('[data-test="category-menu"]').exists()).toBe(true)
    expect(
      page()
        .findAll('.v-list-subheader')
        .map((group) => group.text()),
    ).toEqual(['Income', 'Food & drink', 'Transfers'])
    // A group with none is left out, and taking the category away comes first.
    expect(options()).toEqual([
      'Uncategorized',
      '💼Paycheck',
      '☕Coffee',
      '🛒Groceries',
      '🔁Transfers',
    ])
    expect(
      page()
        .findAll('.v-list-item--active')
        .map((option) => option.text()),
    ).toEqual(['🛒Groceries'])
  })

  it('marks Uncategorized when that is what it is', async () => {
    const { open } = await render(null)
    await open()

    expect(
      page()
        .findAll('.v-list-item--active')
        .map((option) => option.text()),
    ).toEqual(['Uncategorized'])
  })

  it('says which category was chosen, and closes', async () => {
    const { wrapper, open } = await render()
    await open()

    await click(`[data-test="category-option-${coffee.id}"]`)
    await flushPromises()

    expect(wrapper.emitted('select')).toEqual([[coffee.id]])
    await vi.waitFor(() => {
      expect(page().find('[data-test="category-menu"]').isVisible()).toBe(false)
    })
  })

  it('says it is to have none when Uncategorized is chosen', async () => {
    const { wrapper, open } = await render()
    await open()

    await click('[data-test="category-option-none"]')

    expect(wrapper.emitted('select')).toEqual([[null]])
  })

  it('says nothing when the category it has is chosen again', async () => {
    const { wrapper, open } = await render()
    await open()

    await click(`[data-test="category-option-${groceries.id}"]`)
    await flushPromises()

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('says nothing when it has none and none is chosen again', async () => {
    const { wrapper, open } = await render(null)
    await open()

    await click('[data-test="category-option-none"]')
    await flushPromises()

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('finds categories by their own name or their group’s', async () => {
    const { open, options } = await render()
    await open()
    const search = page().find('[data-test="category-search"] input')

    await search.setValue('  COF ')
    expect(options()).toEqual(['☕Coffee'])
    await search.setValue('food')
    expect(options()).toEqual(['☕Coffee', '🛒Groceries'])
    await search.setValue('transfers')
    expect(options()).toEqual(['🔁Transfers'])
    expect(
      page()
        .findAll('.v-list-subheader')
        .map((group) => group.text()),
    ).toEqual(['Transfers'])
  })

  it('offers to take the category away only while a search could mean that', async () => {
    const { open, options } = await render()
    await open()
    const search = page().find('[data-test="category-search"] input')

    await search.setValue('uncat')
    expect(options()).toEqual(['Uncategorized'])
    await search.setValue('xyz')
    expect(options()).toEqual([])
    expect(page().find('[data-test="category-none-match"]').text()).toBe('No categories match')
    await search.setValue('')
    expect(options()).toHaveLength(5)
    expect(page().find('[data-test="category-none-match"]').exists()).toBe(false)
  })

  it('starts from the whole list again each time it opens', async () => {
    const { open, options } = await render()
    await open()
    await page().find('[data-test="category-search"] input').setValue('coffee')
    expect(options()).toEqual(['☕Coffee'])

    await click(`[data-test="category-option-${coffee.id}"]`)
    await vi.waitFor(() => {
      expect(page().find('[data-test="category-menu"]').isVisible()).toBe(false)
    })
    // Pressing it while it is still leaving is another thing, which a person can't do that fast.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await open()

    expect(options()).toHaveLength(5)
    expect(
      (page().find('[data-test="category-search"] input').element as HTMLInputElement).value,
    ).toBe('')
  })

  it('loads the categories when they are not there yet', async () => {
    const fetch = vi.spyOn(categoriesApi, 'fetchCategories').mockResolvedValue(makeGroups())
    const { open, options } = await render()
    const store = useCategoriesStore()
    store.groups = []
    store.loaded = false

    await open()
    await flushPromises()

    expect(fetch).toHaveBeenCalled()
    expect(options()).toContain('💼Paycheck')
    // Whatever kind they are, income, spending or transfers, they are the same to choose.
    expect([paycheck.name, transfers.name]).toEqual(['Paycheck', 'Transfers'])
  })

  it('can be turned off', async () => {
    const { button } = await render(groceries.id, { disabled: true })

    expect(button().attributes('disabled')).toBeDefined()
  })

  it('leaves what it sits in out of it: pressing it is not pressing the row', async () => {
    const row = vi.fn()
    const mounted = await mountWithPlugins(
      defineComponent({
        render: () =>
          h('div', { onClick: row, 'data-test': 'row' }, [
            h(CategoryButton, { categoryId: groceries.id, subject: 'Whole Foods' }),
          ]),
      }),
      { beforeMount: () => seedFinance() },
    )

    await mounted.wrapper.find('[data-test="category-button"]').trigger('click')
    await flushPromises()

    expect(row).not.toHaveBeenCalled()
    expect(page().find('[data-test="category-menu"]').exists()).toBe(true)
  })
})
