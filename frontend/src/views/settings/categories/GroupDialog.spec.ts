import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/categories'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { page } from '@/test/dom'
import { makeGroups, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import GroupDialog from '@/views/settings/categories/GroupDialog.vue'

async function render(group: api.CategoryGroup | null = null) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(GroupDialog, {
        group,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  await mountWithPlugins(Host, { width: 1280, beforeMount: () => seedFinance() })
  open.value = true
  await flushPromises()
  return { open }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const name = () => find('group-name').find('input')
const kind = (value: string) => find(`group-kind-${value}`).find('input')

async function save() {
  await find('group-save').trigger('click')
  await flushPromises()
}

describe('GroupDialog', () => {
  it('adds a group for spending unless told otherwise', async () => {
    const created: api.CategoryGroup = {
      id: 'group-pets',
      name: 'Pets',
      kind: 'expense',
      categories: [],
    }
    const create = vi.spyOn(api, 'createGroup').mockResolvedValue(created)
    const fetch = vi.spyOn(api, 'fetchCategories').mockResolvedValue([...makeGroups(), created])
    const { open } = await render()
    expect(dialog().find('h2').text()).toBe('Add a group')
    expect((kind('expense').element as HTMLInputElement).checked).toBe(true)
    expect(find('group-kind').text()).toContain('Money coming in, like pay, interest or refunds.')
    expect(find('group-save').attributes('disabled')).toBeDefined()

    await name().setValue('  Pets ')
    await flushPromises()
    await save()

    expect(create).toHaveBeenCalledWith({ name: 'Pets', kind: 'expense' })
    expect(fetch).toHaveBeenCalled()
    expect(notices.value.at(-1)?.text).toBe('Added Pets')
    expect(open.value).toBe(false)
  })

  it('renames a group and changes what it is for', async () => {
    const [income] = makeGroups()
    const update = vi
      .spyOn(api, 'updateGroup')
      .mockResolvedValue({ ...income!, name: 'Earnings', kind: 'transfer' })
    vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    await render(income)
    expect(dialog().find('h2').text()).toBe('Edit Income')
    expect((name().element as HTMLInputElement).value).toBe('Income')
    expect((kind('income').element as HTMLInputElement).checked).toBe(true)

    await name().setValue('Earnings')
    await kind('transfer').setValue(true)
    await flushPromises()
    await dialog().find('form').trigger('submit')
    await flushPromises()

    expect(update).toHaveBeenCalledWith(income!.id, { name: 'Earnings', kind: 'transfer' })
    expect(notices.value.at(-1)?.text).toBe('Saved Earnings')
  })

  it('asks for a name of a sensible length', async () => {
    const create = vi.spyOn(api, 'createGroup')
    await render()
    await name().setValue('   ')
    await flushPromises()
    expect(find('group-name').text()).toContain('Enter a name for the group')
    await name().setValue('x'.repeat(61))
    await flushPromises()
    expect(find('group-name').text()).toContain('Keep it under 60 characters')
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })

  it('shows a name already in use by the name', async () => {
    vi.spyOn(api, 'createGroup').mockRejectedValue(
      new ApiError(409, "There's already a group called Income.", { code: 'name_taken' }),
    )
    await render()
    await name().setValue('income')
    await flushPromises()
    await save()
    expect(find('group-name').text()).toContain("There's already a group called Income.")
    expect(find('group-error').exists()).toBe(false)
  })

  it('shows what else went wrong, and starts afresh when opened again', async () => {
    vi.spyOn(api, 'createGroup').mockRejectedValue(new ApiError(0, "Can't reach Cashcove."))
    const { open } = await render()
    await name().setValue('Pets')
    await flushPromises()
    await save()
    expect(find('group-error').text()).toBe("Can't reach Cashcove.")
    expect(open.value).toBe(true)

    await find('dialog-close').trigger('click')
    await flushPromises()
    open.value = true
    await flushPromises()
    expect(find('group-error').exists()).toBe(false)
    expect((name().element as HTMLInputElement).value).toBe('')
  })

  it('closes without saving', async () => {
    const create = vi.spyOn(api, 'createGroup')
    const { open } = await render()
    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })
})
