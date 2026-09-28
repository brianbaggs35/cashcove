import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/imports'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useImportsStore } from '@/stores/imports'
import { answer, menuSettled } from '@/test/confirm'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { checkingImport, harborFormat, makeFormat, mapleFormat, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import SavedFormats from '@/views/import/SavedFormats.vue'

async function render({
  formats = [harborFormat, mapleFormat],
  role = 'admin',
}: { formats?: api.SavedFormat[]; role?: 'admin' | 'viewer' } = {}) {
  const mounted = await mountWithPlugins(SavedFormats, {
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance()
      seedImports({ imports: [checkingImport], formats })
    },
  })
  const items = () => mounted.wrapper.findAll('[data-test="saved-format"]')
  const find = (item: number, name: string) =>
    items()[item]!.find(`[data-test="saved-format-${name}"]`)
  async function choose(item: number, action: string) {
    await menuSettled()
    await find(item, 'actions').trigger('click')
    await flushPromises()
    await page().find(`.v-overlay--active [data-test="saved-format-${action}"]`).trigger('click')
    await flushPromises()
  }
  return { ...mounted, items, find, choose }
}

describe('SavedFormats', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says when no format has been saved', async () => {
    const { wrapper } = await render({ formats: [] })
    expect(wrapper.text()).toContain('No saved formats yet')
    expect(wrapper.find('.v-chip').exists()).toBe(false)
  })

  it('shows each format’s columns and when it was last used', async () => {
    const headerless = makeFormat({
      id: 'format-wells',
      name: 'Wells Fargo checking',
      headers: [],
      account_id: 'account-gone',
      last_used_at: '2026-09-28T09:00:00Z',
    })
    const { wrapper, items, find } = await render({
      formats: [harborFormat, mapleFormat, headerless],
    })
    expect(wrapper.find('.v-chip').text()).toBe('3')
    expect(items()).toHaveLength(3)
    expect(find(0, 'name').text()).toBe('Harbor Credit Union checking')
    expect(find(0, 'columns').text()).toBe('Date · Description · Amount · Balance · Transaction ID')
    expect(find(0, 'used').text()).toBe('Last used May 31, 2026 for Everyday checking')
    expect(find(1, 'used').text()).toBe('Not used yet')
    expect(find(2, 'columns').text()).toBe('Files without column names')
    expect(find(2, 'used').text()).toBe('Last used 3 hours ago')
  })

  it('leaves viewers without the actions', async () => {
    const { find } = await render({ role: 'viewer' })
    expect(find(0, 'actions').exists()).toBe(false)
  })

  it('renames a format in its dialog', async () => {
    const { find, choose } = await render()
    expect(find(1, 'actions').attributes('aria-label')).toBe('Actions for Maple store card')
    await choose(1, 'rename')
    const field = page().find('.v-overlay--active [data-test="format-name-field"] input')
    expect((field.element as HTMLInputElement).value).toBe('Maple store card')

    await page().find('.v-overlay--active [data-test="dialog-close"]').trigger('click')
    await flushPromises()
    expect(page().find('.v-overlay--active [data-test="format-name-field"]').exists()).toBe(false)
  })

  it('deletes a format after checking', async () => {
    const remove = vi.spyOn(api, 'deleteSavedFormat').mockResolvedValue(undefined)
    const { items, choose } = await render()

    await choose(0, 'delete')
    expect(confirmRequest.value).toMatchObject({
      title: 'Delete the Harbor Credit Union checking format?',
      confirmText: 'Delete format',
    })
    await answer(true)

    expect(remove).toHaveBeenCalledWith(harborFormat.id)
    expect(items()).toHaveLength(1)
    expect(useImportsStore().findImport(checkingImport.id)?.profile_id).toBeNull()
    expect(notices.value.at(-1)?.text).toBe('Deleted the Harbor Credit Union checking format')
  })

  it('keeps a format whose deleting was cancelled', async () => {
    const remove = vi.spyOn(api, 'deleteSavedFormat')
    const { items, choose } = await render()
    await choose(0, 'delete')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()
    expect(items()).toHaveLength(2)
  })
})
