import { createPinia, setActivePinia } from 'pinia'

import * as billsApi from '@/api/bills'
import * as api from '@/api/subscriptions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { makeBill, makeSubscription } from '@/test/subscriptions'

describe('subscriptions store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the subscriptions and bills once and finds either by ID', async () => {
    const paused = makeSubscription({ id: 'subscription-paused', name: 'Gym', active: false })
    const pausedBill = makeBill({ id: 'bill-water', name: 'Water', active: false })
    const fetch = vi
      .spyOn(api, 'fetchSubscriptions')
      .mockResolvedValue([makeSubscription(), paused])
    const fetchBills = vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([makeBill(), pausedBill])
    const store = useSubscriptionsStore()

    await Promise.all([store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetchBills).toHaveBeenCalledTimes(1)
    expect(store.find('subscription-streamflix')?.name).toBe('Streamflix')
    expect(store.find('bill-power')?.name).toBe('City Power')
    expect(store.find(null)).toBeUndefined()
    expect(store.find('missing')).toBeUndefined()
    // Each kind is listed apart, and the ones paused aren't being tracked.
    expect(store.subscriptions.map((item) => item.name)).toEqual(['Streamflix', 'Gym'])
    expect(store.bills.map((item) => item.name)).toEqual(['City Power', 'Water'])
    expect(store.recurring).toHaveLength(4)
    expect(store.active.map((item) => item.name)).toEqual(['Streamflix'])
    expect(store.activeBills.map((item) => item.name)).toEqual(['City Power'])
  })

  it('keeps what went wrong, and loads again when asked', async () => {
    const fetch = vi
      .spyOn(api, 'fetchSubscriptions')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([makeSubscription()])
    vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([makeBill()])
    const store = useSubscriptionsStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)

    await store.load()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(store.error).toBeNull()
    expect(store.subscriptions).toHaveLength(1)
    expect(store.bills).toHaveLength(1)
  })

  it('does not show half of what loaded when the bills would not', async () => {
    vi.spyOn(api, 'fetchSubscriptions').mockResolvedValue([makeSubscription()])
    vi.spyOn(billsApi, 'fetchBills').mockRejectedValue(new Error('Offline'))
    const store = useSubscriptionsStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loaded).toBe(false)
    expect(store.subscriptions).toEqual([])
  })
})
