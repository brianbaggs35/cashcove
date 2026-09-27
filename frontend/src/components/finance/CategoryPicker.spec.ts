import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/categories'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import { page } from '@/test/dom'
import { coffee, groceries, makeGroups, seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins, type MountOptions } from '@/test/mount'

async function render(initial: string | null, options: MountOptions = {}) {
  const category = ref<string | null>(initial)
  const Host = defineComponent({
    render: () =>
      h(CategoryPicker, {
        modelValue: category.value,
        'onUpdate:modelValue': (value: string | null) => (category.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
    ...options,
  })
  const input = wrapper.find('input')
  async function open() {
    await wrapper.find('.v-field').trigger('mousedown')
    await flushPromises()
  }
  return { wrapper, category, input, open }
}

const options = () => page().findAll('.v-overlay--active .v-list-item[role="option"]')
const subheaders = () =>
  page()
    .findAll('.v-overlay--active .v-list-subheader')
    .map((header) => header.text())

describe('CategoryPicker', () => {
  it('lists the categories under their groups and picks one', async () => {
    const { wrapper, category, open } = await render(null)
    expect(wrapper.find('label').text()).toBe('Category')

    await open()
    expect(subheaders()).toEqual(['Income', 'Food & drink', 'Transfers'])
    expect(options().map((option) => option.text())).toEqual([
      '💼Paycheck',
      '☕Coffee',
      '🛒Groceries',
      '🔁Transfers',
    ])
    await options()[2]!.trigger('click')
    await flushPromises()

    expect(category.value).toBe(groceries.id)
    expect(wrapper.find('.category-picker__emoji').text()).toBe('🛒')
  })

  it('finds categories by their name or their group', async () => {
    const { input, open } = await render(null)
    await open()

    await input.setValue('cof')
    await flushPromises()
    expect(options().map((option) => option.text())).toEqual(['☕Coffee'])
    await input.setValue('food')
    await flushPromises()
    expect(options().map((option) => option.text())).toEqual(['☕Coffee', '🛒Groceries'])
    await input.setValue('zzz')
    await flushPromises()
    expect(page().find('.v-overlay--active').text()).toContain('No categories match')
  })

  it('clears to uncategorized', async () => {
    const { wrapper, category } = await render(coffee.id)
    await wrapper.find('.v-field__clearable .v-icon').trigger('click')
    await flushPromises()
    expect(category.value).toBeNull()
    expect(wrapper.find('.category-picker__emoji').exists()).toBe(false)
  })

  it('links admins to where categories are managed', async () => {
    const { open } = await render(null)
    await open()
    expect(page().find('[data-test="category-manage"]').attributes('href')).toBe(
      '/settings/categories',
    )
  })

  it('leaves the link out for viewers, and loads categories when needed', async () => {
    const fetch = vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const { open } = await render(null, {
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
      beforeMount: undefined,
    })
    await open()
    expect(fetch).toHaveBeenCalled()
    expect(options()).toHaveLength(4)
    expect(page().find('[data-test="category-manage"]').exists()).toBe(false)
  })
})
