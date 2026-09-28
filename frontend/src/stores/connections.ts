import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { errorMessage } from '@/api/client'
import { fetchConnections, type Connection } from '@/api/connections'
import { useAccountsStore } from '@/stores/accounts'

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Checks often while a bank syncs, and now and then while a new one's history comes in. */
export const SYNCING_POLL = 3_000
export const IMPORTING_POLL = 20_000

/** Balances and transactions change as banks sync, so the accounts are read again. */
function refreshAccounts() {
  const accounts = useAccountsStore()
  if (accounts.loaded) void accounts.load()
}

/** The banks connected through Plaid, for the Connect tab and the navigation's alerts. */
export const useConnectionsStore = defineStore('connections', () => {
  const connections = ref<Connection[]>([])
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  /** Connections that can't sync until someone does something, or whose last sync failed. */
  const attention = computed(() =>
    connections.value.filter((connection) => connection.status !== 'healthy'),
  )

  /** How soon to check again for what a sync changed, or null when nothing is in progress. */
  const pollDelay = computed(() => {
    if (connections.value.some((connection) => connection.syncing)) return SYNCING_POLL
    const importing = connections.value.some(
      (connection) => connection.history !== 'complete' && connection.next_sync_at !== null,
    )
    return importing ? IMPORTING_POLL : null
  })

  /** Which sync each connection had last, to tell when one finished. */
  const lastSyncs = () =>
    connections.value.map((connection) => `${connection.id}:${connection.last_sync?.id}`).join()

  function replace(next: Connection[]) {
    connections.value = [...next].sort(
      (a, b) => byName.compare(a.institution_name, b.institution_name) || a.id.localeCompare(b.id),
    )
  }

  function load(): Promise<void> {
    pending ??= (async () => {
      error.value = null
      try {
        const before = lastSyncs()
        replace(await fetchConnections())
        if (loaded.value && lastSyncs() !== before) refreshAccounts()
        loaded.value = true
      } catch (loadError) {
        error.value = errorMessage(loadError)
      } finally {
        pending = null
      }
    })()
    return pending
  }

  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function find(id: string | null | undefined): Connection | undefined {
    return connections.value.find((connection) => connection.id === id)
  }

  /** Adds a connection, or replaces it with what the API sent back after a change. */
  function put(connection: Connection) {
    replace([...connections.value.filter((item) => item.id !== connection.id), connection])
    refreshAccounts()
  }

  function remove(id: string) {
    connections.value = connections.value.filter((connection) => connection.id !== id)
    refreshAccounts()
  }

  return {
    connections,
    loaded,
    error,
    attention,
    pollDelay,
    load,
    ensureLoaded,
    find,
    put,
    remove,
  }
})
