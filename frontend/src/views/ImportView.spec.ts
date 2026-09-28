import { flushPromises } from '@vue/test-utils'

import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import {
  checkingImport,
  harborFormat,
  later,
  mapleFormat,
  savingsImport,
  statementFile,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import FileDrop from '@/views/import/FileDrop.vue'
import ImportView from '@/views/ImportView.vue'

async function render(role: 'admin' | 'viewer' = 'admin') {
  const mounted = await mountWithPlugins(ImportView, {
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance(),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

function answerLists() {
  vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([harborFormat, mapleFormat])
  return vi.spyOn(api, 'fetchImports').mockResolvedValue([savingsImport, checkingImport])
}

describe('ImportView', () => {
  it('lists what’s been imported and the saved formats', async () => {
    const imports = later<api.FileImport[]>()
    vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([harborFormat, mapleFormat])
    vi.spyOn(api, 'fetchImports').mockReturnValue(imports.promise)
    const { find, wrapper } = await render()
    expect(wrapper.find('h1').text()).toBe('Import')
    expect(find('file-drop').exists()).toBe(true)
    expect(find('read-only-notice').exists()).toBe(false)
    expect(find('imports-loading').exists()).toBe(true)

    imports.resolve([savingsImport, checkingImport])
    await flushPromises()
    expect(find('imports-loading').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="import-item"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-test="saved-format"]')).toHaveLength(2)
  })

  it('shows viewers what’s been imported, with nothing to change', async () => {
    answerLists()
    const { find, wrapper } = await render('viewer')
    expect(find('read-only-notice').text()).toContain('Only an admin can import files')
    expect(find('file-drop').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="import-item"]')).toHaveLength(2)
  })

  it('says when the imports can’t be loaded, and tries again', async () => {
    const fetch = answerLists().mockRejectedValueOnce(new ApiError(0, 'Can’t reach Cashcove.'))
    const { find, wrapper } = await render()
    expect(find('imports-error').text()).toContain(
      "Couldn't load the imports. Can’t reach Cashcove.",
    )

    await find('imports-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('imports-error').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="import-item"]')).toHaveLength(2)
  })

  it('imports a chosen file, and lets another be chosen when it can’t be read', async () => {
    answerLists()
    const previewing = vi
      .spyOn(api, 'previewImport')
      .mockRejectedValue(new ApiError(422, 'This isn’t a statement.', { code: 'unreadable_file' }))
    const { wrapper } = await render()

    wrapper.findComponent(FileDrop).vm.$emit('file', statementFile('notes.txt'))
    await vi.waitFor(() => {
      expect(previewing).toHaveBeenCalled()
    })
    await flushPromises()
    const dialog = page().find('.v-overlay--active .app-dialog')
    expect(dialog.find('h2').text()).toBe('Couldn’t import notes.txt')

    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined)
    await dialog.find('[data-test="import-choose-again"]').trigger('click')
    expect(click).toHaveBeenCalledOnce()
    expect(click.mock.contexts[0]).toBe(wrapper.find('input[type="file"]').element)

    await dialog.find('[data-test="import-close"]').trigger('click')
    await flushPromises()
    expect(page().find('.v-overlay--active .app-dialog').exists()).toBe(false)
  })
})
