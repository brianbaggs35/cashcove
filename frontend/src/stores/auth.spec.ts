import { createPinia, setActivePinia } from 'pinia'

import * as authApi from '@/api/auth'
import * as passkeys from '@/auth/passkeys'
import { useAuthStore } from '@/stores/auth'
import { makeSessionState, makeUser, signedOutState } from '@/test/fixtures'

describe('auth store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts knowing nothing about the session', () => {
    const auth = useAuthStore()
    expect(auth.user).toBeNull()
    expect(auth.session).toBeNull()
    expect(auth.signedIn).toBe(false)
    expect(auth.isAdmin).toBe(false)
    expect(auth.setupRequired).toBe(false)
    expect(auth.origin).toBe(window.location.origin)
    expect(auth.wrongOrigin).toBe(false)
    expect(auth.passkeysAvailable).toBe(false)
  })

  it('knows who is signed in and what they can do', () => {
    const auth = useAuthStore()
    auth.apply(makeSessionState())
    expect(auth.signedIn).toBe(true)
    expect(auth.isAdmin).toBe(true)
    expect(auth.session?.csrf_token).toBe('csrf-token')
    auth.apply(makeSessionState({ user: makeUser({ role: 'viewer' }) }))
    expect(auth.isAdmin).toBe(false)
    auth.apply(signedOutState({ setup_required: true }))
    expect(auth.setupRequired).toBe(true)
  })

  it('offers passkeys only where they can work', () => {
    const auth = useAuthStore()
    const supported = vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(true)
    auth.apply(makeSessionState())
    expect(auth.passkeysAvailable).toBe(true)
    auth.apply(makeSessionState({ passkeys_supported: false }))
    expect(auth.passkeysAvailable).toBe(false)
    auth.apply(makeSessionState({ origin: 'https://cashcove.example.com' }))
    expect(auth.wrongOrigin).toBe(true)
    expect(auth.origin).toBe('https://cashcove.example.com')
    expect(auth.passkeysAvailable).toBe(false)
    supported.mockReturnValue(false)
    auth.apply(makeSessionState())
    expect(auth.passkeysAvailable).toBe(false)
  })

  it('clears why someone was signed out once they sign in again', () => {
    const auth = useAuthStore()
    auth.forget('expired')
    auth.apply(signedOutState())
    expect(auth.signedOutReason).toBe('expired')
    auth.apply(makeSessionState())
    expect(auth.signedOutReason).toBeNull()
  })

  it('loads the session once, however many pages ask', async () => {
    const fetchSession = vi.spyOn(authApi, 'fetchSession').mockResolvedValue(makeSessionState())
    const auth = useAuthStore()
    await Promise.all([auth.ensureLoaded(), auth.ensureLoaded()])
    await auth.ensureLoaded()
    expect(fetchSession).toHaveBeenCalledOnce()
    expect(auth.signedIn).toBe(true)
  })

  it('tries again after failing to load', async () => {
    const fetchSession = vi
      .spyOn(authApi, 'fetchSession')
      .mockRejectedValueOnce(new Error('Offline.'))
      .mockResolvedValue(signedOutState())
    const auth = useAuthStore()
    await expect(auth.ensureLoaded()).rejects.toThrow('Offline.')
    expect(auth.loadError).toBe('Offline.')
    await auth.ensureLoaded()
    expect(auth.loadError).toBeNull()
    expect(fetchSession).toHaveBeenCalledTimes(2)
  })

  it('updates details of the signed-in person only', () => {
    const auth = useAuthStore()
    auth.updateUser({ passkey_count: 1 })
    expect(auth.state).toBeNull()
    auth.apply(signedOutState())
    auth.updateUser({ passkey_count: 1 })
    expect(auth.user).toBeNull()
    auth.apply(makeSessionState())
    auth.updateUser({ passkey_count: 2, name: 'Alex M' })
    expect(auth.user).toMatchObject({ passkey_count: 2, name: 'Alex M', email: 'alex@example.com' })
  })

  it('forgets the person, keeping what it knows about the install', () => {
    const auth = useAuthStore()
    auth.forget('expired')
    expect(auth.state).toBeNull()
    expect(auth.signedOutReason).toBe('expired')
    auth.apply(makeSessionState({ passkeys_supported: false }))
    auth.forget('password_reset')
    expect(auth.user).toBeNull()
    expect(auth.session).toBeNull()
    expect(auth.state?.passkeys_supported).toBe(false)
    expect(auth.signedOutReason).toBe('password_reset')
  })

  it('signs out on the server, and forgets the person even if that fails', async () => {
    const auth = useAuthStore()
    auth.apply(makeSessionState())
    const signOut = vi.spyOn(authApi, 'signOut').mockResolvedValue(undefined)
    await auth.signOut()
    expect(signOut).toHaveBeenCalledOnce()
    expect(auth.signedIn).toBe(false)
    expect(auth.signedOutReason).toBe('signed_out')

    auth.apply(makeSessionState())
    signOut.mockRejectedValue(new Error('Offline.'))
    await auth.signOut()
    expect(auth.signedIn).toBe(false)
  })

  it('records activity', () => {
    const auth = useAuthStore()
    auth.lastActivity = 0
    auth.touch()
    expect(auth.lastActivity).toBeGreaterThan(0)
  })
})
