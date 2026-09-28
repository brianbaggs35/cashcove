import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import type { Connection } from '@/api/connections'
import { makeSync, tartan } from '@/test/connections'
import { page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'
import SyncHistoryDialog from '@/views/connect/SyncHistoryDialog.vue'

async function render(connection: Connection | null = tartan) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(SyncHistoryDialog, {
        connection,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  await mountWithPlugins(Host, { width: 1280 })
  open.value = true
  await flushPromises()
  return { open }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)

describe('SyncHistoryDialog', () => {
  it('lists the recent syncs: when, why, and what each did', async () => {
    const fetch = vi.spyOn(api, 'fetchSyncs').mockResolvedValue([
      makeSync({ id: 's1', trigger: 'manual', added: 2, updated: 0 }),
      makeSync({
        id: 's2',
        trigger: 'scheduled',
        started_at: '2026-09-27T03:00:00Z',
        finished_at: '2026-09-27T03:00:14.400Z',
        added: 0,
        updated: 0,
      }),
      makeSync({
        id: 's3',
        trigger: 'reconnected',
        succeeded: false,
        error_message: 'Plaid couldn’t reach the bank just now.',
      }),
      makeSync({ id: 's4', trigger: 'linked', succeeded: false, error_message: null }),
    ])
    const { open } = await render()

    expect(fetch).toHaveBeenCalledWith(tartan.id)
    expect(dialog().find('h2').text()).toBe('Tartan Bank sync history')
    const items = dialog().findAll('[data-test="sync-history-item"]')
    expect(items[0]!.text()).toContain('Sync now')
    expect(items[0]!.text()).toContain('2 new transactions · took 2 s')
    expect(items[1]!.text()).toContain('Scheduled')
    expect(items[1]!.text()).toContain('Nothing new · took 14 s')
    expect(items[2]!.text()).toContain('After reconnecting')
    expect(items[2]!.text()).toContain('Plaid couldn’t reach the bank just now.')
    expect(items[3]!.text()).toContain('After connecting')
    expect(items[3]!.text()).toContain('The sync failed.')

    await dialog().findAll('.v-card-actions button').at(-1)!.trigger('click')
    expect(open.value).toBe(false)
  })

  it('says how long a quick sync took', async () => {
    vi.spyOn(api, 'fetchSyncs').mockResolvedValue([
      makeSync({ started_at: '2026-09-27T09:00:00Z', finished_at: '2026-09-27T09:00:00.400Z' }),
    ])
    await render()
    expect(find('sync-history-item').text()).toContain('took under a second')
  })

  it('says when there are no syncs yet', async () => {
    vi.spyOn(api, 'fetchSyncs').mockResolvedValue([])
    await render()
    expect(dialog().find('[data-test="empty-state"]').text()).toContain('No syncs yet')
  })

  it('shows a skeleton while loading, then offers to try again when loading fails', async () => {
    let fail: (error: Error) => void = () => undefined
    const fetch = vi.spyOn(api, 'fetchSyncs').mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    await render()
    expect(find('sync-history-loading').exists()).toBe(true)
    fail(new ApiError(0, 'Offline.'))
    await flushPromises()
    expect(find('sync-history-error').text()).toContain("Couldn't load the sync history. Offline.")

    fetch.mockResolvedValue([])
    await find('sync-history-error').find('button').trigger('click')
    await flushPromises()
    expect(find('sync-history-error').exists()).toBe(false)
  })

  it('has nothing to load without a connection', async () => {
    const fetch = vi.spyOn(api, 'fetchSyncs')
    await render(null)
    expect(fetch).not.toHaveBeenCalled()
    expect(dialog().find('h2').text()).toBe('Sync history')
  })
})
