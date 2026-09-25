import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser'

import { apiGet, apiPost } from '@/api/client'

export type Role = 'admin' | 'viewer'
export type TwoFactorMethod = 'totp' | 'recovery_code' | 'passkey'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  is_active: boolean
  totp_enabled: boolean
  passkey_count: number
  recovery_codes_left: number
  created_at: string
  last_sign_in_at: string | null
  /** The handle this person's passkeys carry, for telling the browser which are current. */
  webauthn_user_id: string
}

export interface SessionInfo {
  csrf_token: string
  expires_at: string
  idle_timeout_seconds: number
  remember: boolean
}

export interface SessionState {
  setup_required: boolean
  user: User | null
  session: SessionInfo | null
  /** The address Cashcove is configured for; passkeys only work there. */
  origin: string
  passkeys_supported: boolean
}

export interface SignInResult {
  status: 'signed_in' | 'two_factor_required'
  state: SessionState | null
  methods: TwoFactorMethod[]
}

/** A WebAuthn challenge: `options` go to the browser, `challenge_id` comes back with the answer. */
export interface PasskeyOptions<T> {
  challenge_id: string
  options: T
}

export type PasskeyRequestOptions = PasskeyOptions<PublicKeyCredentialRequestOptionsJSON>
export type PasskeyCreationOptions = PasskeyOptions<PublicKeyCredentialCreationOptionsJSON>

export interface SetupRequest {
  setup_code: string
  name: string
  email: string
  password: string
}

export interface InvitationPreview {
  household_name: string
  name: string
  email: string
  role: Role
  invited_by: string | null
  expires_at: string
}

export interface PasswordResetPreview {
  name: string
  email: string
  expires_at: string
}

export const fetchSession = () => apiGet<SessionState>('/auth/session')

export const checkSetupCode = (setupCode: string) =>
  apiPost('/auth/setup/check', { setup_code: setupCode })
export const completeSetup = (body: SetupRequest) => apiPost<SessionState>('/auth/setup', body)

export const signIn = (email: string, password: string, remember: boolean) =>
  apiPost<SignInResult>('/auth/sign-in', { email, password, remember })
export const signInWithTotp = (code: string) =>
  apiPost<SignInResult>('/auth/sign-in/totp', { code })
export const signInWithRecoveryCode = (code: string) =>
  apiPost<SignInResult>('/auth/sign-in/recovery-code', { code })
export const secondStepPasskeyOptions = () =>
  apiPost<PasskeyRequestOptions>('/auth/sign-in/passkey/options')
export const signInSecondStepWithPasskey = (
  challengeId: string,
  credential: AuthenticationResponseJSON,
) => apiPost<SignInResult>('/auth/sign-in/passkey', { challenge_id: challengeId, credential })

export const passkeySignInOptions = () => apiPost<PasskeyRequestOptions>('/auth/passkey/options')
export const signInWithPasskey = (
  challengeId: string,
  credential: AuthenticationResponseJSON,
  remember: boolean,
) => apiPost<SignInResult>('/auth/passkey', { challenge_id: challengeId, credential, remember })

export const signOut = () => apiPost('/auth/sign-out')

export const previewInvitation = (token: string) =>
  apiPost<InvitationPreview>('/auth/invitations/preview', { token })
export const acceptInvitation = (token: string, name: string, password: string) =>
  apiPost<SessionState>('/auth/invitations/accept', { token, name, password })

export const previewPasswordReset = (token: string) =>
  apiPost<PasswordResetPreview>('/auth/password-resets/preview', { token })
export const completePasswordReset = (token: string, password: string) =>
  apiPost('/auth/password-resets/complete', { token, password })
