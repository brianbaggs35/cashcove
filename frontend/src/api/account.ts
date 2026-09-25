import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'

import type { PasskeyCreationOptions, PasskeyRequestOptions, User } from '@/api/auth'
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/client'

export type DeviceKind = 'desktop' | 'phone' | 'tablet' | 'unknown'

export interface TotpSetup {
  secret: string
  /** An otpauth:// link, shown as a QR code. */
  uri: string
  expires_at: string
}

export interface RecoveryCodes {
  codes: string[]
}

export interface Passkey {
  id: string
  credential_id: string
  name: string
  /** The password manager or device that holds it, when Cashcove recognises it. */
  provider: string | null
  /** Synced to the person's other devices, e.g. through iCloud Keychain. */
  backed_up: boolean
  created_at: string
  last_used_at: string | null
}

export interface SignedInSession {
  id: string
  device: string
  browser: string | null
  system: string | null
  kind: DeviceKind
  ip_address: string | null
  remember: boolean
  current: boolean
  created_at: string
  last_seen_at: string
}

export interface ActivityEntry {
  id: string
  event: string
  created_at: string
  user_name: string | null
  actor_name: string | null
  ip_address: string | null
  device: string | null
  details: Record<string, unknown>
}

// Confirming it's you before a sensitive change.
export const verifyWithPassword = (password: string) =>
  apiPost('/account/verify/password', { password })
export const verifyWithTotp = (code: string) => apiPost('/account/verify/totp', { code })
export const verifyWithPasskeyOptions = () =>
  apiPost<PasskeyRequestOptions>('/account/verify/passkey/options')
export const verifyWithPasskey = (challengeId: string, credential: AuthenticationResponseJSON) =>
  apiPost('/account/verify/passkey', { challenge_id: challengeId, credential })

// Profile and password.
export const fetchAccount = () => apiGet<User>('/account')
export const updateProfile = (name: string, email: string) =>
  apiPut<User>('/account/profile', { name, email })
export const changePassword = (currentPassword: string, newPassword: string) =>
  apiPost('/account/password', { current_password: currentPassword, new_password: newPassword })

// Two-step verification.
export const startTotpSetup = () => apiPost<TotpSetup>('/account/totp')
export const confirmTotpSetup = (code: string) =>
  apiPost<RecoveryCodes>('/account/totp/confirm', { code })
export const turnOffTotp = () => apiDelete('/account/totp')
export const createRecoveryCodes = () => apiPost<RecoveryCodes>('/account/recovery-codes')

// Passkeys.
export const fetchPasskeys = () => apiGet<Passkey[]>('/account/passkeys')
export const passkeyRegistrationOptions = () =>
  apiPost<PasskeyCreationOptions>('/account/passkeys/options')
export const addPasskey = (challengeId: string, credential: RegistrationResponseJSON, name = '') =>
  apiPost<Passkey>('/account/passkeys', { challenge_id: challengeId, credential, name })
export const renamePasskey = (id: string, name: string) =>
  apiPatch<Passkey>(`/account/passkeys/${id}`, { name })
export const removePasskey = (id: string) => apiDelete(`/account/passkeys/${id}`)

// Signed-in browsers and recent activity.
export const fetchSessions = () => apiGet<SignedInSession[]>('/account/sessions')
export const endSession = (id: string) => apiDelete(`/account/sessions/${id}`)
export const endOtherSessions = () =>
  apiPost<{ ended: number }>('/account/sessions/sign-out-others')
export const fetchActivity = (limit = 50) =>
  apiGet<ActivityEntry[]>(`/account/activity?limit=${limit}`)
