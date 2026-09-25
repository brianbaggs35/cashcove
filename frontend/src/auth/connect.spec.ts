import { createPinia, setActivePinia } from 'pinia'

import { CSRF_HEADER, apiGet, apiPost } from '@/api/client'
import { connectApi } from '@/auth/connect'
import { verificationRequest } from '@/composables/verification'
import { useAuthStore } from '@/stores/auth'
import { makeSessionState, signedOutState } from '@/test/fixtures'

function respond(status: number, body: unknown) {
  return { ok: status < 300, status, json: () => Promise.resolve(body) }
}

const notSignedIn = { detail: { code: 'not_signed_in', message: 'Sign in again.' } }
const verificationRequired = { detail: { code: 'verification_required', message: 'Confirm.' } }

describe('connectApi', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('sends the session CSRF token and counts requests as activity', async () => {
    const auth = useAuthStore()
    auth.apply(makeSessionState())
    auth.lastActivity = 0
    connectApi()
    const fetchMock = vi.fn().mockResolvedValue(respond(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await apiPost('/thing', {})
    const headers = (fetchMock.mock.lastCall as [string, RequestInit])[1].headers as Headers
    expect(headers.get(CSRF_HEADER)).toBe('csrf-token')
    expect(auth.lastActivity).toBeGreaterThan(0)
  })

  it('sends no token without a session', async () => {
    useAuthStore().apply(signedOutState())
    connectApi()
    const fetchMock = vi.fn().mockResolvedValue(respond(200, {}))
    vi.stubGlobal('fetch', fetchMock)
    await apiPost('/thing', {})
    const headers = (fetchMock.mock.lastCall as [string, RequestInit])[1].headers as Headers
    expect(headers.has(CSRF_HEADER)).toBe(false)
  })

  it('forgets the person when the API says their session ended', async () => {
    const auth = useAuthStore()
    auth.apply(makeSessionState())
    connectApi()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(401, notSignedIn)))
    await apiGet('/account').catch(() => undefined)
    expect(auth.signedIn).toBe(false)
    expect(auth.signedOutReason).toBe('expired')
    // Already signed out: nothing changes.
    auth.signedOutReason = 'signed_out'
    await apiGet('/account').catch(() => undefined)
    expect(auth.signedOutReason).toBe('signed_out')
  })

  it('asks signed-in people to confirm it is them', async () => {
    const auth = useAuthStore()
    auth.apply(makeSessionState())
    connectApi()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(respond(403, verificationRequired))
        .mockResolvedValue(respond(200, { ok: true })),
    )
    const request = apiPost('/account/totp')
    await vi.waitFor(() => {
      expect(verificationRequest.value).not.toBeNull()
    })
    verificationRequest.value!.resolve(true)
    await expect(request).resolves.toEqual({ ok: true })
  })

  it('never asks someone who is signed out', async () => {
    useAuthStore().apply(signedOutState())
    connectApi()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond(403, verificationRequired)))
    await expect(apiPost('/account/totp')).rejects.toMatchObject({ code: 'verification_required' })
    expect(verificationRequest.value).toBeNull()
  })
})
