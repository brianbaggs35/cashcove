import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchAccounts, type Account } from '@/api/accounts'
import { errorMessage } from '@/api/client'

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** Open accounts first, then by name: the order the API lists them in. */
export function sortAccounts(accounts: Account[]): Account[] {
  return [...accounts].sort(
    (a, b) => Number(!!a.closed_at) - Number(!!b.closed_at) || byName.compare(a.name, b.name),
  )
}

/** The household's accounts, shared by the Accounts and Transactions tabs. */
export const useAccountsStore = defineStore('accounts', () => {
  const accounts = ref<Account[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  const byId = computed(() => new Map(accounts.value.map((account) => [account.id, account])))
  const open = computed(() => accounts.value.filter((account) => !account.closed_at))
  const closed = computed(() => accounts.value.filter((account) => account.closed_at))
  /** Where transactions can be added by hand: open accounts the household keeps itself. */
  const manual = computed(() => open.value.filter((account) => account.source === 'manual'))

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        accounts.value = await fetchAccounts()
        loaded.value = true
      } catch (loadError) {
        error.value = errorMessage(loadError)
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }

  /** Loads the accounts the first time something needs them. */
  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function find(id: string | null | undefined): Account | undefined {
    return id ? byId.value.get(id) : undefined
  }

  /** Adds an account, or replaces it with what the API sent back after a change. */
  function put(account: Account) {
    accounts.value = sortAccounts([
      ...accounts.value.filter((item) => item.id !== account.id),
      account,
    ])
  }

  function remove(id: string) {
    accounts.value = accounts.value.filter((account) => account.id !== id)
  }

  return {
    accounts,
    loaded,
    loading,
    error,
    byId,
    open,
    closed,
    manual,
    load,
    ensureLoaded,
    find,
    put,
    remove,
  }
})
