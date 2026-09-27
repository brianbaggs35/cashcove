import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/accounts'
import { ApiError } from '@/api/client'
import { sortAccounts, useAccountsStore } from '@/stores/accounts'
import { checking, makeAccount, savings, visa } from '@/test/finance'

describe('accounts store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the accounts once and sorts them into open, closed and manual', async () => {
    const closed = makeAccount({ id: 'account-old', name: 'Old card', closed_at: '2026-01-01T00:00:00Z' })
    const fetch = vi.spyOn(api, 'fetchAccounts').mockResolvedValue([checking, savings, visa, closed])
    const store = useAccountsStore()

    const first = store.ensureLoaded()
    expect(store.loading).toBe(true)
    // Asking again while it loads waits for the same request.
    await Promise.all([first, store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.open.map((account) => account.id)).toEqual([checking.id, savings.id, visa.id])
    expect(store.closed).toEqual([closed])
    expect(store.manual.map((account) => account.id)).toEqual([checking.id, savings.id])
    expect(store.find(visa.id)).toEqual(visa)
    expect(store.find(null)).toBeUndefined()
    expect(store.find('missing')).toBeUndefined()
  })

  it('keeps what went wrong', async () => {
    vi.spyOn(api, 'fetchAccounts').mockRejectedValue(new ApiError(0, "Can't reach Cashcove."))
    const store = useAccountsStore()

    await store.load()

    expect(store.error).toBe("Can't reach Cashcove.")
    expect(store.loaded).toBe(false)
  })

  it('adds, replaces and removes accounts in order', () => {
    const store = useAccountsStore()
    store.accounts = [savings, visa]

    store.put(checking)
    expect(store.accounts.map((account) => account.name)).toEqual([
      'Everyday checking',
      'Rainy day fund',
      'Rewards Visa',
    ])
    store.put({ ...savings, name: 'A fund' })
    expect(store.accounts.map((account) => account.name)[0]).toBe('A fund')
    store.remove(visa.id)
    expect(store.accounts).toHaveLength(2)
  })

  it('sorts open accounts first, then by name', () => {
    const closed = makeAccount({ id: 'closed', name: 'Aardvark', closed_at: '2026-01-01T00:00:00Z' })
    const account2 = makeAccount({ id: 'two', name: 'account 2' })
    const account10 = makeAccount({ id: 'ten', name: 'Account 10' })
    expect(sortAccounts([closed, account10, account2]).map((account) => account.id)).toEqual([
      'two',
      'ten',
      'closed',
    ])
  })
})
