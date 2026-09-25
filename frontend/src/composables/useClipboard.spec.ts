import { effectScope } from 'vue'

import { notices } from '@/composables/notify'
import { useClipboard } from '@/composables/useClipboard'

describe('useClipboard', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup(writeText: (text: string) => Promise<void>) {
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const scope = effectScope()
    const clipboard = scope.run(() => useClipboard(1000))!
    return { scope, ...clipboard }
  }

  it('copies and shows a check mark for a moment', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { copy, copied, scope } = setup(writeText)
    await expect(copy('secret')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('secret')
    expect(copied.value).toBe(true)
    await copy('again')
    vi.advanceTimersByTime(999)
    expect(copied.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(copied.value).toBe(false)
    scope.stop()
  })

  it('says so when copying is not allowed', async () => {
    const { copy, copied, scope } = setup(() => Promise.reject(new Error('denied')))
    await expect(copy('secret')).resolves.toBe(false)
    expect(copied.value).toBe(false)
    expect(notices.value[0]).toMatchObject({ tone: 'error' })
    scope.stop()
  })

  it('stops its timer when the component goes away', async () => {
    const { copy, copied, scope } = setup(() => Promise.resolve())
    await copy('secret')
    scope.stop()
    vi.advanceTimersByTime(5000)
    expect(copied.value).toBe(true)
  })

  it('uses a two second check mark by default', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: () => Promise.resolve() } })
    const scope = effectScope()
    const { copy, copied } = scope.run(() => useClipboard())!
    await copy('x')
    vi.advanceTimersByTime(1999)
    expect(copied.value).toBe(true)
    vi.advanceTimersByTime(1)
    expect(copied.value).toBe(false)
    scope.stop()
  })
})
