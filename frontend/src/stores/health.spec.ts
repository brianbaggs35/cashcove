import { createPinia, setActivePinia } from 'pinia'

import * as healthApi from '@/api/health'
import { useHealthStore } from '@/stores/health'

describe('health store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the health report', async () => {
    const report = { status: 'ok', version: '0.1.0', database: 'ok' } as const
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue(report)
    const store = useHealthStore()
    const pending = store.refresh()
    expect(store.loading).toBe(true)
    await pending
    expect(store.loading).toBe(false)
    expect(store.health).toEqual(report)
    expect(store.error).toBeNull()
  })

  it('records an error message and clears stale data', async () => {
    const store = useHealthStore()
    store.health = { status: 'ok', version: '0.1.0', database: 'ok' }
    vi.spyOn(healthApi, 'fetchHealth').mockRejectedValue(new Error('offline'))
    await store.refresh()
    expect(store.health).toBeNull()
    expect(store.error).toBe('offline')
    expect(store.loading).toBe(false)
  })

  it('handles non-Error rejections', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockRejectedValue('boom')
    const store = useHealthStore()
    await store.refresh()
    expect(store.error).toBe('boom')
  })
})
