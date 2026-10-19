import { flushPromises } from '@vue/test-utils'

import type { ImportPreview, SavedFormat } from '@/api/imports'
import { useImportWizard } from '@/stores/importWizard'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import {
  harborFormat,
  makeFormat,
  makePreview,
  mapleFormat,
  seedImports,
  seedWizard,
} from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import FormatPicker from '@/views/import/FormatPicker.vue'

const wells = makeFormat({
  id: 'format-wells',
  name: 'Wells checking',
  headers: [],
  account_id: null,
  last_used_at: null,
})

async function render(
  preview: ImportPreview = makePreview(),
  formats: SavedFormat[] = [harborFormat, mapleFormat],
) {
  const mounted = await mountWithPlugins(FormatPicker, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      seedImports({ formats })
      seedWizard(preview)
    },
  })
  const wizard = useImportWizard()
  const choose = vi.spyOn(wizard, 'chooseFormat').mockResolvedValue()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  /** Opens the menu of formats, and lists what it offers. */
  async function offered() {
    await find('format-choice').find('.v-field').trigger('mousedown')
    await flushPromises()
    return page().findAll('.v-menu.v-overlay--active .v-list-item')
  }
  /** What the file is read with, as the menu shows it. */
  const shown = () => find('format-choice').find('.v-select__selection-text').text()
  return { ...mounted, wizard, choose, find, offered, shown }
}

describe('FormatPicker', () => {
  it('is offered once there is a saved format to choose', async () => {
    const { find, wrapper } = await render(makePreview(), [])
    expect(find('format-picker').exists()).toBe(false)
    expect(wrapper.html()).not.toContain('Read this file with')

    const offered = await render()
    expect(offered.find('format-picker').exists()).toBe(true)
  })

  it('offers a new format, and every saved format with the columns it reads', async () => {
    const { offered } = await render(makePreview(), [harborFormat, mapleFormat, wells])

    expect((await offered()).map((item) => item.text())).toEqual([
      'New formatMatch the columns here, and save them for the bank’s next file',
      'Harbor Credit Union checkingDate · Description · Amount · Balance · Transaction ID',
      'Maple store cardTrans. Date · Post Date · Description · Amount · Category',
      'Wells checkingFiles without column names',
    ])
  })

  it('shows what the file is read with now', async () => {
    expect((await render()).shown()).toBe('New format')
    expect((await render(makePreview({ profile_id: mapleFormat.id }))).shown()).toBe(
      'Maple store card',
    )
    // A saved format that was deleted meanwhile is no longer one to read it with.
    expect((await render(makePreview({ profile_id: 'format-deleted' }))).shown()).toBe('New format')
  })

  it('reads the file with the saved format chosen', async () => {
    const { offered, choose } = await render()

    await (
      await offered()
    )
      .find((item) => item.text().startsWith('Maple store card'))!
      .trigger('click')
    await flushPromises()

    expect(choose).toHaveBeenCalledExactlyOnceWith(mapleFormat.id)
  })

  it('reads the file as a new format when that’s chosen', async () => {
    const { offered, choose } = await render(makePreview({ profile_id: harborFormat.id }))

    await (await offered()).find((item) => item.text().startsWith('New format'))!.trigger('click')
    await flushPromises()

    expect(choose).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('says nothing about a format until one is turned down', async () => {
    const { find } = await render()
    expect(find('format-problem').exists()).toBe(false)
  })

  it('says why a saved format was turned down, and offers a new one instead', async () => {
    const why = 'The Maple store card format doesn’t fit this file: column 4 is “Category”.'
    const { find, wizard, choose } = await render(makePreview({ profile_id: harborFormat.id }))
    wizard.formatProblem = why
    await flushPromises()

    const problem = find('format-problem')
    expect(problem.attributes('role')).toBe('alert')
    expect(problem.text()).toContain(why)
    expect(problem.text()).toContain('Still reading with your Harbor Credit Union checking format.')
    await find('format-create-new').trigger('click')
    expect(choose).toHaveBeenCalledExactlyOnceWith(null)
  })

  it('says the columns are as they were found when a new format was in use', async () => {
    const { find, wizard } = await render()
    wizard.formatProblem = 'The Maple store card format doesn’t fit this file.'
    await flushPromises()

    expect(find('format-problem').text()).toContain(
      'The columns below are as Cashcove found them. Choose another format, or go on to save them as a new one.',
    )
    expect(find('format-create-new').exists()).toBe(false)
  })
})
