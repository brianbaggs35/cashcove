import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/subscriptions'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { makeSubscription } from '@/test/subscriptions'

describe('subscriptions store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the subscriptions once and finds them by ID', async () => {
    const paused = makeSubscription({ id: 'subscription-paused', name: 'Gym', active: false })
    const fetch = vi
      .spyOn(api, 'fetchSubscriptions')
      .mockResolvedValue([makeSubscription(), paused])
    const store = useSubscriptionsStore()

    await Promise.all([store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.find('subscription-streamflix')?.name).toBe('Streamflix')
    expect(store.find(null)).toBeUndefined()
    expect(store.find('missing')).toBeUndefined()
    expect(store.active.map((item) => item.name)).toEqual(['Streamflix'])
  })

  it('keeps what went wrong, and loads again when asked', async () => {
    const fetch = vi
      .spyOn(api, 'fetchSubscriptions')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([makeSubscription()])
    const store = useSubscriptionsStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)

    await store.load()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(store.error).toBeNull()
    expect(store.subscriptions).toHaveLength(1)
  })
})
