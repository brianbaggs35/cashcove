import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import { notices } from '@/composables/notify'
import { useImportsStore } from '@/stores/imports'
import { page } from '@/test/dom'
import { harborFormat, mapleFormat, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import RenameFormatDialog from '@/views/import/RenameFormatDialog.vue'

async function render(format: api.SavedFormat | null = harborFormat) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(RenameFormatDialog, {
        format,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  await mountWithPlugins(Host, { width: 1280, beforeMount: () => seedImports() })
  open.value = true
  await flushPromises()
  return { open }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const name = () => find('format-name-field').find('input')

async function rename(text: string) {
  await name().setValue(text)
  await flushPromises()
  await find('format-rename-save').trigger('click')
  await flushPromises()
}

describe('RenameFormatDialog', () => {
  it('renames a saved format', async () => {
    const renamed = { ...harborFormat, name: 'Harbor checking' }
    const update = vi.spyOn(api, 'renameSavedFormat').mockResolvedValue(renamed)
    const { open } = await render()
    expect(dialog().find('h2').text()).toBe('Rename saved format')
    expect((name().element as HTMLInputElement).value).toBe(harborFormat.name)

    await rename('  Harbor checking ')

    expect(update).toHaveBeenCalledWith(harborFormat.id, 'Harbor checking')
    expect(useImportsStore().formats.map((format) => format.name)).toEqual([
      'Harbor checking',
      mapleFormat.name,
    ])
    expect(notices.value.at(-1)?.text).toBe('Renamed it Harbor checking')
    expect(open.value).toBe(false)
  })

  it('asks for a name of a sensible length', async () => {
    const update = vi.spyOn(api, 'renameSavedFormat')
    const { open } = await render(null)
    expect((name().element as HTMLInputElement).value).toBe('')
    await name().setValue('   ')
    await flushPromises()
    expect(find('format-name-field').text()).toContain('Give it a name')
    await name().setValue('x'.repeat(81))
    await flushPromises()
    expect(find('format-name-field').text()).toContain('Keep it under 80 characters')
    await dialog().find('form').trigger('submit')
    await flushPromises()
    expect(update).not.toHaveBeenCalled()

    await find('dialog-close').trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
  })

  it('shows a name another format has, or the API turned down, by the name', async () => {
    vi.spyOn(api, 'renameSavedFormat')
      .mockRejectedValueOnce(
        new ApiError(409, 'There’s already a saved format called Maple store card.', {
          code: 'name_taken',
        }),
      )
      .mockRejectedValueOnce(
        new ApiError(422, 'Check the name.', {
          code: 'validation_error',
          fields: { name: 'That isn’t a name.' },
        }),
      )
    await render()

    await rename('maple store card')
    expect(find('format-name-field').text()).toContain(
      'There’s already a saved format called Maple store card.',
    )
    expect(find('format-rename-error').exists()).toBe(false)

    await rename('Harbor?')
    expect(find('format-name-field').text()).toContain('That isn’t a name.')
    expect(find('format-rename-error').exists()).toBe(false)
  })

  it('shows what else went wrong until the name changes, and starts afresh when opened again', async () => {
    vi.spyOn(api, 'renameSavedFormat').mockRejectedValue(new ApiError(0, 'Can’t reach Cashcove.'))
    const { open } = await render()
    await rename('Harbor checking')
    expect(find('format-rename-error').text()).toBe('Can’t reach Cashcove.')

    await name().setValue('Harbor checking 2')
    await flushPromises()
    expect(find('format-rename-error').exists()).toBe(false)

    await rename('Harbor checking')
    await dialog()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()
    expect(find('format-rename-error').exists()).toBe(false)
    expect((name().element as HTMLInputElement).value).toBe(harborFormat.name)
  })
})
