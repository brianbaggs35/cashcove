import { flushPromises } from '@vue/test-utils'

import * as accountsApi from '@/api/accounts'
import * as api from '@/api/imports'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useImportsStore } from '@/stores/imports'
import { answer } from '@/test/confirm'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { checkingImport, makeImport, savingsImport, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import ImportHistory from '@/views/import/ImportHistory.vue'

async function render({
  imports = [savingsImport, checkingImport],
  role = 'admin',
}: { imports?: api.FileImport[]; role?: 'admin' | 'viewer' } = {}) {
  const mounted = await mountWithPlugins(ImportHistory, {
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance()
      seedImports({ imports })
    },
  })
  const items = () => mounted.wrapper.findAll('[data-test="import-item"]')
  const find = (item: number, name: string) => items()[item]!.find(`[data-test="import-${name}"]`)
  // Date ranges have thin spaces around their dash.
  const text = (item: number, name: string) => find(item, name).text().replace(/\s/g, ' ')
  return { ...mounted, items, find, text }
}

describe('ImportHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-28T12:00:00Z'), toFake: ['Date'] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says when nothing has been imported', async () => {
    const { wrapper } = await render({ imports: [] })
    expect(wrapper.text()).toContain('Nothing imported yet')
    expect(wrapper.find('.v-chip').exists()).toBe(false)
  })

  it('shows what each file brought in, and when', async () => {
    const { wrapper, items, find, text } = await render()
    expect(wrapper.find('h2').text()).toBe('Recent imports')
    expect(items()).toHaveLength(2)
    expect(find(0, 'item-name').text()).toBe('harbor-savings.qfx')
    expect(items()[0]!.find('.v-chip').text()).toBe('QFX')
    expect(text(0, 'item-details')).toBe(
      'Rainy day fund · 19 transactions · Aug 29, 2025 – May 26, 2026',
    )
    expect(find(0, 'item-total').text()).toBe('+$2,349.77')
    expect(text(0, 'item-when')).toBe('Imported May 31, 2026 by Alex Rivera')
    expect(text(1, 'item-when')).toBe('Imported May 31, 2026 by Alex Rivera · 2 left out')
    expect(find(1, 'item-transactions').attributes('href')).toBe(
      '/transactions?import=import-checking',
    )
  })

  it('names deleted accounts and people', async () => {
    const { text } = await render({
      imports: [
        makeImport({
          account_id: 'account-gone',
          created_by: null,
          skipped: 0,
          created_at: '2026-09-28T10:00:00Z',
        }),
      ],
    })
    expect(text(0, 'item-details')).toMatch(/^a deleted account · 62 transactions/)
    expect(text(0, 'item-when')).toBe('Imported 2 hours ago')
  })

  it('shows the latest five, and the rest when asked', async () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      makeImport({ id: `import-${index}`, file_name: `month-${index}.csv` }),
    )
    const { wrapper, items } = await render({ imports: many })
    const more = () => wrapper.find('[data-test="import-history-more"]')
    expect(items()).toHaveLength(5)
    expect(more().text()).toBe('Show all 7')
    await more().trigger('click')
    expect(items()).toHaveLength(7)
    expect(more().text()).toBe('Show fewer')
  })

  it('lets only admins undo an import', async () => {
    const { find } = await render({ role: 'viewer' })
    expect(find(0, 'item-undo').exists()).toBe(false)
    expect(find(0, 'item-transactions').exists()).toBe(true)
  })

  it('undoes an import after checking', async () => {
    const undo = vi.spyOn(api, 'undoImport').mockResolvedValue({ count: 62 })
    const reload = vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([])
    const { find, items } = await render({
      imports: [savingsImport, makeImport({ balance_change: '31390.29' })],
    })

    await find(1, 'item-undo').trigger('click')
    expect(find(1, 'item-undo').attributes('aria-label')).toBe('Undo importing harbor-checking.csv')
    expect(confirmRequest.value).toMatchObject({
      title: 'Undo importing harbor-checking.csv?',
      text: 'This deletes the 62 transactions it added to Everyday checking and puts its balance back. Changes made to them since are lost.',
      confirmText: 'Undo import',
    })
    await answer(true)
    await flushPromises()

    expect(undo).toHaveBeenCalledWith(checkingImport.id)
    expect(items()).toHaveLength(1)
    expect(useImportsStore().findImport(checkingImport.id)).toBeUndefined()
    expect(reload).toHaveBeenCalledOnce()
    expect(notices.value.at(-1)?.text).toBe('Deleted the 62 transactions from harbor-checking.csv')
  })

  it('keeps an import whose undoing was cancelled', async () => {
    const undo = vi.spyOn(api, 'undoImport')
    const { find, items } = await render()
    await find(0, 'item-undo').trigger('click')
    expect(confirmRequest.value?.text).toBe(
      'This deletes the 19 transactions it added to Rainy day fund. Changes made to them since are lost.',
    )
    await answer(false)
    expect(undo).not.toHaveBeenCalled()
    expect(items()).toHaveLength(2)
  })
})
