import { createPinia, setActivePinia } from 'pinia'

import * as healthApi from '@/api/health'
import * as systemApi from '@/api/system'
import { useHealthStore } from '@/stores/health'
import { healthyReport, makeSystemInfo } from '@/test/fixtures'

describe('health store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads health and system info together', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue(healthyReport)
    vi.spyOn(systemApi, 'fetchSystemInfo').mockResolvedValue(makeSystemInfo())
    const store = useHealthStore()
    const pending = store.refresh()
    expect(store.loading).toBe(true)
    await pending
    expect(store.loading).toBe(false)
    expect(store.health).toEqual(healthyReport)
    expect(store.system).toEqual(makeSystemInfo())
    expect(store.error).toBeNull()
  })

  it('records an error message and clears stale data', async () => {
    const store = useHealthStore()
    store.health = healthyReport
    store.system = makeSystemInfo()
    vi.spyOn(healthApi, 'fetchHealth').mockRejectedValue(new Error('offline'))
    vi.spyOn(systemApi, 'fetchSystemInfo').mockResolvedValue(makeSystemInfo())
    await store.refresh()
    expect(store.health).toBeNull()
    expect(store.system).toBeNull()
    expect(store.error).toBe('offline')
    expect(store.loading).toBe(false)
  })

  it('handles non-Error rejections', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue(healthyReport)
    vi.spyOn(systemApi, 'fetchSystemInfo').mockRejectedValue('boom')
    const store = useHealthStore()
    await store.refresh()
    expect(store.error).toBe('boom')
  })
})
