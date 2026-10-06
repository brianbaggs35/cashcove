import { effectScope } from 'vue'

import { useElapsed } from '@/composables/useElapsed'

describe('useElapsed', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  it('counts the whole seconds since it started, and stops with its scope', () => {
    const scope = effectScope()
    const { seconds } = scope.run(() => useElapsed())!
    expect(seconds.value).toBe(0)

    vi.advanceTimersByTime(1000)
    expect(seconds.value).toBe(1)
    vi.advanceTimersByTime(61_000)
    expect(seconds.value).toBe(62)

    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
