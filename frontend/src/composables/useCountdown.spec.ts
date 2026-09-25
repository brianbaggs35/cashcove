import { effectScope, nextTick, ref } from 'vue'

import { useCountdown } from '@/composables/useCountdown'

describe('useCountdown', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  it('counts whole seconds down to the deadline, then stops', async () => {
    const deadline = ref<number | null>(1_000_000 + 2500)
    const scope = effectScope()
    const { remaining, running } = scope.run(() => useCountdown(deadline))!
    expect(remaining.value).toBe(3)
    expect(running.value).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(remaining.value).toBe(2)
    vi.advanceTimersByTime(2000)
    expect(remaining.value).toBe(0)
    expect(running.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    deadline.value = null
    await nextTick()
    expect(remaining.value).toBe(0)
    scope.stop()
  })

  it('does not tick for a deadline already past, and restarts for a new one', async () => {
    const deadline = ref<number | null>(1_000_000 - 1)
    const scope = effectScope()
    const { remaining } = scope.run(() => useCountdown(deadline))!
    expect(remaining.value).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    deadline.value = Date.now() + 5000
    await nextTick()
    expect(remaining.value).toBe(5)
    scope.stop()
    expect(vi.getTimerCount()).toBe(0)
  })
})
