import { flushPromises } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import SessionTimeoutHost from '@/components/auth/SessionTimeoutHost.vue'
import { useAuthStore } from '@/stores/auth'
import { click, page } from '@/test/dom'
import { makeSessionInfo, makeSessionState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'

const NOW = new Date('2026-09-25T12:00:00Z').getTime()
const IDLE = 3600

/** Mounts the host with the session idle for `idleFor` seconds, and `expiresIn` seconds left. */
async function render({ idleFor = 0, expiresIn = 30 * 86400 } = {}) {
  const state = makeSessionState({
    session: makeSessionInfo({
      idle_timeout_seconds: IDLE,
      expires_at: new Date(NOW + expiresIn * 1000).toISOString(),
    }),
  })
  const mounted = await mountWithPlugins(SessionTimeoutHost, { session: state })
  const auth = useAuthStore()
  auth.lastActivity = Date.now() - idleFor * 1000
  await flushPromises()
  return { ...mounted, auth, state }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')

describe('SessionTimeoutHost', () => {
  beforeEach(() => vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] }))
  afterEach(() => vi.useRealTimers())

  it('stays out of the way while the session has plenty of time', async () => {
    await render()
    expect(dialog().exists()).toBe(false)
  })

  it('warns two minutes before an idle session ends, and can keep it going', async () => {
    // The server may be up to a minute behind, so the warning allows for that.
    const { auth } = await render({ idleFor: IDLE - 60 - 100 })
    expect(dialog().find('h2').text()).toBe('Are you still there?')
    expect(page().find('[data-test="session-timeout-text"]').text()).toContain('1:40')
    vi.advanceTimersByTime(1000)
    await flushPromises()
    expect(page().find('[data-test="session-timeout-text"]').text()).toContain('1:39')

    await click('[data-test="session-stay"]')
    await flushPromises()
    expect(authApi.fetchSession).toHaveBeenCalled()
    expect(auth.lastActivity).toBe(Date.now())
    expect(dialog().exists()).toBe(false)
  })

  it('warns when the session reaches the end of its lifetime, with no way to extend it', async () => {
    await render({ expiresIn: 90 })
    expect(dialog().find('h2').text()).toBe('Your session is ending')
    expect(page().find('[data-test="session-timeout-text"]').text()).toContain('1:30')
    expect(page().find('[data-test="session-stay"]').exists()).toBe(false)
  })

  it('signs out when asked', async () => {
    const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(undefined)
    const { auth } = await render({ expiresIn: 90 })
    await click('[data-test="session-sign-out"]')
    await flushPromises()
    expect(signOut).toHaveBeenCalledOnce()
    expect(auth.signedOutReason).toBe('signed_out')
  })

  it('signs out once a session reaches the end of its lifetime', async () => {
    const { auth } = await render({ expiresIn: 5 })
    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(auth.signedIn).toBe(false)
    expect(auth.signedOutReason).toBe('expired')
  })

  it('signs out when time runs out and the server cannot be asked', async () => {
    const { auth } = await render({ idleFor: IDLE - 60 - 3 })
    vi.mocked(authApi.fetchSession).mockRejectedValue(new Error('Offline.'))
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(auth.signedOutReason).toBe('expired')
  })

  it('keeps the session when the server says it is still going', async () => {
    const { auth } = await render({ idleFor: IDLE - 60 - 3 })
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(auth.signedIn).toBe(true)
    expect(dialog().exists()).toBe(false)
  })

  it('leaves it to the server when the session already ended there', async () => {
    const { auth } = await render({ idleFor: IDLE - 60 - 3 })
    vi.mocked(authApi.fetchSession).mockImplementation(() => {
      auth.forget('expired')
      return Promise.reject(new Error('Not signed in.'))
    })
    vi.advanceTimersByTime(3000)
    await flushPromises()
    expect(auth.signedOutReason).toBe('expired')
  })

  it('renews the session in the background while someone is active', async () => {
    const { auth } = await render({ idleFor: 6 * 60 })
    const fetchSession = vi.mocked(authApi.fetchSession)
    fetchSession.mockClear()
    window.dispatchEvent(new Event('keydown'))
    await flushPromises()
    expect(fetchSession).toHaveBeenCalledOnce()
    // Recently renewed, so more activity doesn't ask again.
    window.dispatchEvent(new Event('pointerdown'))
    await flushPromises()
    expect(fetchSession).toHaveBeenCalledOnce()
    expect(auth.lastActivity).toBe(Date.now())
  })

  it('does not renew for a hidden page, or while the warning is up', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await render({ idleFor: IDLE - 60 - 100 })
    const fetchSession = vi.mocked(authApi.fetchSession)
    fetchSession.mockClear()
    window.dispatchEvent(new Event('wheel'))
    visibility.mockReturnValue('visible')
    window.dispatchEvent(new Event('touchstart'))
    await flushPromises()
    expect(fetchSession).not.toHaveBeenCalled()
  })

  it('checks the clock every 15 seconds and cleans up when it goes away', async () => {
    const { wrapper } = await render({ idleFor: IDLE - 60 - 130 })
    expect(dialog().exists()).toBe(false)
    vi.advanceTimersByTime(15_000)
    await flushPromises()
    expect(dialog().exists()).toBe(true)
    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('has nothing to count down without a session', async () => {
    const { auth } = await render()
    auth.forget('signed_out')
    await flushPromises()
    expect(dialog().exists()).toBe(false)
  })
})
