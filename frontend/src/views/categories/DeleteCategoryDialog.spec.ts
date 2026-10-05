import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/categories'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { coffee, groceries, makeCategory, makeGroups, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import DeleteCategoryDialog from '@/views/categories/DeleteCategoryDialog.vue'

async function render(category: api.Category) {
  const open = ref(true)
  const Host = defineComponent({
    render: () =>
      h(DeleteCategoryDialog, {
        category,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const picker = () => wrapper.findComponent({ name: 'CategoryPicker' })
  return { open, picker }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const confirmButton = () => find('delete-category-confirm')
const choice = (label: string) =>
  dialog()
    .findAll('.v-radio')
    .find((radio) => radio.text() === label)!
    .find('input')

async function confirm() {
  await confirmButton().trigger('click')
  await flushPromises()
}

describe('DeleteCategoryDialog', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
  })

  it('leaves what used it uncategorized unless told otherwise', async () => {
    const remove = vi.spyOn(api, 'deleteCategory').mockResolvedValue(undefined)
    const { open, picker } = await render(groceries)
    expect(dialog().find('h2').text()).toBe('Delete Groceries?')
    expect(dialog().text()).toContain('4 transactions use it. What should happen to them?')
    // Nothing has to be chosen: uncategorized is the default.
    expect(
      dialog()
        .findAll('.v-radio')
        .map((radio) => radio.text()),
    ).toEqual(['Leave them uncategorized', 'Move them to another category'])
    expect(choice('Leave them uncategorized').element.checked).toBe(true)
    expect(picker().exists()).toBe(false)
    expect(confirmButton().attributes('disabled')).toBeUndefined()
    // What files things in the category follows them.
    expect(find('delete-category-follows').text()).toContain(
      'Subscriptions, bills and automations that use it follow',
    )
    await confirm()

    expect(remove).toHaveBeenCalledWith(groceries.id, null)
    expect(notices.value.at(-1)?.text).toBe('Deleted Groceries')
    expect(open.value).toBe(false)
  })

  it('moves its transactions to another category', async () => {
    const remove = vi.spyOn(api, 'deleteCategory').mockResolvedValue(undefined)
    const { open, picker } = await render(groceries)
    await choice('Move them to another category').setValue(true)
    await flushPromises()
    expect(picker().props('exclude')).toBe(groceries.id)
    // Moving them needs somewhere to go.
    expect(confirmButton().attributes('disabled')).toBeDefined()

    picker().vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    await confirm()

    expect(remove).toHaveBeenCalledWith(groceries.id, coffee.id)
    expect(notices.value.at(-1)?.text).toBe('Deleted Groceries')
    expect(open.value).toBe(false)
  })

  it('goes back to uncategorized after choosing somewhere to move them', async () => {
    const remove = vi.spyOn(api, 'deleteCategory').mockResolvedValue(undefined)
    const { picker } = await render(coffee)
    expect(dialog().text()).toContain('1 transaction uses it. What should happen to it?')

    await choice('Move them to another category').setValue(true)
    await flushPromises()
    picker().vm.$emit('update:modelValue', groceries.id)
    await choice('Leave them uncategorized').setValue(true)
    await flushPromises()
    expect(picker().exists()).toBe(false)
    await confirm()

    expect(remove).toHaveBeenCalledWith(coffee.id, null)
  })

  it('just deletes one no transactions use', async () => {
    const remove = vi.spyOn(api, 'deleteCategory').mockResolvedValue(undefined)
    await render(makeCategory({ transaction_count: 0 }))
    expect(find('delete-category-unused').text()).toBe(
      "No transactions use it. Any subscriptions, bills or automations that do are left uncategorized. This can't be undone.",
    )
    expect(find('delete-category-keep').exists()).toBe(false)
    await confirm()
    expect(remove).toHaveBeenCalledWith(groceries.id, null)
  })

  it('closes without deleting', async () => {
    const remove = vi.spyOn(api, 'deleteCategory')
    const { open } = await render(groceries)
    await find('dialog-close').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(remove).not.toHaveBeenCalled()
  })

  it('says what went wrong, and starts afresh when opened again', async () => {
    vi.spyOn(api, 'deleteCategory').mockRejectedValue(
      new ApiError(404, "That category doesn't exist anymore."),
    )
    const { open, picker } = await render(groceries)
    await choice('Move them to another category').setValue(true)
    await flushPromises()
    picker().vm.$emit('update:modelValue', coffee.id)
    await flushPromises()
    await confirm()
    expect(find('delete-category-error').text()).toBe("That category doesn't exist anymore.")
    expect(open.value).toBe(true)

    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    open.value = true
    await flushPromises()
    expect(find('delete-category-error').exists()).toBe(false)
    // Back to the default, with nowhere chosen to move them.
    expect(choice('Leave them uncategorized').element.checked).toBe(true)
    expect(picker().exists()).toBe(false)
  })
})
