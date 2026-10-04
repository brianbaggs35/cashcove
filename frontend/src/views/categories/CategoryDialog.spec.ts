import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/categories'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { click, page } from '@/test/dom'
import { coffee, makeCategory, makeGroups, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import CategoryDialog from '@/views/categories/CategoryDialog.vue'

async function render(
  props: { category?: api.Category | null; groupId?: string | null } = {},
  groups = makeGroups(),
) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(CategoryDialog, {
        category: null,
        ...props,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance({ groups }),
  })
  open.value = true
  await flushPromises()
  return { open, wrapper }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const name = () => find('category-name').find('input')
const group = () => find('category-group').find('.v-select__selection-text')

async function save() {
  await find('category-save').trigger('click')
  await flushPromises()
}

describe('CategoryDialog', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
  })

  it('adds a category to the group it was asked from', async () => {
    const created = makeCategory({ id: 'category-pizza', name: 'Pizza', emoji: '🍕' })
    const create = vi.spyOn(api, 'createCategory').mockResolvedValue(created)
    const { open } = await render({ groupId: 'group-food' })
    expect(dialog().find('h2').text()).toBe('Add a category')
    expect(find('emoji-picker').text()).toBe('🏷️')
    expect(group().text()).toBe('Food & drink')

    await find('emoji-picker').trigger('click')
    await flushPromises()
    await click('.v-overlay--active [aria-label="Pizza"]')
    await name().setValue(' Pizza ')
    await flushPromises()
    await save()

    expect(create).toHaveBeenCalledWith({ emoji: '🍕', name: 'Pizza', group_id: 'group-food' })
    expect(notices.value.at(-1)?.text).toBe('Added Pizza')
    expect(open.value).toBe(false)
  })

  it('puts a new category in the first group unless told otherwise', async () => {
    await render()
    expect(group().text()).toBe('Income')
  })

  it('asks for a group when there are none', async () => {
    await render({}, [])
    await name().setValue('Pizza')
    await flushPromises()
    expect(group().exists()).toBe(false)
    expect(find('category-save').attributes('disabled')).toBeDefined()
  })

  it('renames a category and moves it to another group', async () => {
    const update = vi.spyOn(api, 'updateCategory').mockResolvedValue({ ...coffee, name: 'Cafés' })
    const { wrapper } = await render({ category: coffee })
    expect(dialog().find('h2').text()).toBe('Edit Coffee')
    expect(find('emoji-picker').text()).toBe('☕')
    expect((name().element as HTMLInputElement).value).toBe('Coffee')
    expect(group().text()).toBe('Food & drink')

    await name().setValue('Cafés')
    wrapper.findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 'group-empty')
    await flushPromises()
    await dialog().find('form').trigger('submit')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(coffee.id, {
      emoji: '☕',
      name: 'Cafés',
      group_id: 'group-empty',
    })
    expect(notices.value.at(-1)?.text).toBe('Saved Cafés')
  })

  it('closes without saving, from Cancel or its close button', async () => {
    const create = vi.spyOn(api, 'createCategory')
    const { open } = await render()
    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)

    open.value = true
    await flushPromises()
    await find('dialog-close').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('asks for a name of a sensible length', async () => {
    const create = vi.spyOn(api, 'createCategory')
    await render()
    await name().setValue('  ')
    await flushPromises()
    expect(find('category-name').text()).toContain('Enter a name for the category')
    await name().setValue('x'.repeat(61))
    await flushPromises()
    expect(find('category-name').text()).toContain('Keep it under 60 characters')
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows a name already in use by the name, and anything else below', async () => {
    vi.spyOn(api, 'createCategory')
      .mockRejectedValueOnce(
        new ApiError(409, "There's already a category called Coffee.", { code: 'name_taken' }),
      )
      .mockRejectedValueOnce(new ApiError(404, "That group doesn't exist anymore."))
    await render()
    await name().setValue('coffee')
    await flushPromises()
    await save()
    expect(find('category-name').text()).toContain("There's already a category called Coffee.")
    expect(find('category-error').exists()).toBe(false)
    expect(find('category-save').attributes('disabled')).toBeDefined()

    await name().setValue('Cold brew')
    await flushPromises()
    expect(find('category-name').text()).not.toContain('already a category')
    await save()
    expect(find('category-error').text()).toBe("That group doesn't exist anymore.")
  })
})
