import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import * as accountsApi from '@/api/accounts'
import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import { useAccountsStore } from '@/stores/accounts'
import { IMPORTING_POLL, SYNCING_POLL, useConnectionsStore } from '@/stores/connections'
import { fidelity, makeConnection, makeSync, tartan } from '@/test/connections'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('connections store', () => {
  it('loads the connections by bank name, once however many ask', async () => {
    const fetch = vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan, fidelity])
    const store = useConnectionsStore()

    await Promise.all([store.load(), store.ensureLoaded()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledOnce()
    expect(store.connections.map((connection) => connection.institution_name)).toEqual([
      'Fidelity',
      'Tartan Bank',
    ])
    expect(store.find('connection-tartan')).toEqual(tartan)
    expect(store.find(null)).toBeUndefined()
    expect(store.attention).toEqual([fidelity])
  })

  it('keeps the same order for banks with the same name', async () => {
    const twin = makeConnection({ id: 'connection-a' })
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan, twin])
    const store = useConnectionsStore()
    await store.load()
    expect(store.connections.map((connection) => connection.id)).toEqual([
      'connection-a',
      'connection-tartan',
    ])
  })

  it('says why they could not be loaded', async () => {
    vi.spyOn(api, 'fetchConnections').mockRejectedValue(new ApiError(0, 'Offline.'))
    const store = useConnectionsStore()
    await store.load()
    expect(store.loaded).toBe(false)
    expect(store.error).toBe('Offline.')
  })

  it('reads the accounts again when a sync has finished', async () => {
    const reload = vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([])
    const fetch = vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
    const store = useConnectionsStore()
    await store.load()
    useAccountsStore().loaded = true

    await store.load()
    expect(reload).not.toHaveBeenCalled()

    fetch.mockResolvedValue([makeConnection({ last_sync: makeSync({ id: 'sync-2' }) })])
    await store.load()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reads the accounts again after a change, if anything shows them', async () => {
    const reload = vi.spyOn(accountsApi, 'fetchAccounts').mockResolvedValue([])
    const store = useConnectionsStore()

    store.put(tartan)
    expect(reload).not.toHaveBeenCalled()

    useAccountsStore().loaded = true
    store.put(makeConnection({ institution_name: 'Tartan Bank & Trust' }))
    expect(store.connections).toHaveLength(1)
    expect(store.connections[0]!.institution_name).toBe('Tartan Bank & Trust')
    await flushPromises()
    store.remove(tartan.id)
    expect(store.connections).toEqual([])
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('checks back often while a bank syncs, and now and then while history comes in', () => {
    const store = useConnectionsStore()
    expect(store.pollDelay).toBeNull()
    store.connections = [
      tartan,
      makeConnection({ id: 'c2', history: 'recent', next_sync_at: null }),
    ]
    expect(store.pollDelay).toBeNull()
    store.connections = [tartan, makeConnection({ id: 'c2', history: 'pending' })]
    expect(store.pollDelay).toBe(IMPORTING_POLL)
    store.connections = [makeConnection({ syncing: true })]
    expect(store.pollDelay).toBe(SYNCING_POLL)
  })
})
