import type { ActivityEntry, Passkey, SignedInSession } from '@/api/account'
import type { SessionInfo, SessionState, User } from '@/api/auth'
import type { Health } from '@/api/health'
import type { Preferences } from '@/api/preferences'
import type { SystemInfo } from '@/api/system'
import type { Invitation, Member } from '@/api/users'

export function makePreferences(): Preferences {
  return {
    general: {
      household_name: 'My household',
      currency: 'USD',
      locale: 'en-US',
      week_starts_on: 'sunday',
      fiscal_year_start_month: 1,
    },
    alerts: {
      subscription_due_enabled: true,
      subscription_due_days_before: 3,
      low_balance_enabled: true,
      low_balance_threshold: '100.00',
      large_transaction_enabled: true,
      large_transaction_threshold: '500.00',
      budget_threshold_enabled: true,
      budget_threshold_percent: 90,
      sync_failure_enabled: true,
    },
    sync: { auto_sync: true, interval_hours: 6, history_days: 730 },
  }
}

export const healthyReport: Health = { status: 'ok', database: 'ok' }
export const degradedReport: Health = { status: 'degraded', database: 'unavailable' }

export function makeSystemInfo(plaid: Partial<SystemInfo['plaid']> = {}): SystemInfo {
  return {
    version: '0.1.0',
    environment: 'production',
    plaid: { configured: false, environment: 'sandbox', ...plaid },
  }
}

export function makeUser(changes: Partial<User> = {}): User {
  return {
    id: 'user-alex',
    email: 'alex@example.com',
    name: 'Alex Morgan',
    role: 'admin',
    is_active: true,
    totp_enabled: false,
    passkey_count: 0,
    recovery_codes_left: 0,
    created_at: '2026-01-15T12:00:00Z',
    last_sign_in_at: '2026-09-25T09:00:00Z',
    webauthn_user_id: 'webauthn-alex',
    ...changes,
  }
}

export function makeSessionInfo(changes: Partial<SessionInfo> = {}): SessionInfo {
  return {
    csrf_token: 'csrf-token',
    expires_at: '2026-10-25T12:00:00Z',
    idle_timeout_seconds: 3600,
    remember: false,
    ...changes,
  }
}

/** A signed-in admin by default; pass `user: null` for someone signed out. */
export function makeSessionState(changes: Partial<SessionState> = {}): SessionState {
  const user = changes.user === undefined ? makeUser() : changes.user
  return {
    setup_required: false,
    user,
    session: user ? makeSessionInfo() : null,
    origin: window.location.origin,
    passkeys_supported: true,
    ...changes,
  }
}

export const signedOutState = (changes: Partial<SessionState> = {}) =>
  makeSessionState({ user: null, ...changes })

export function makeMember(changes: Partial<Member> = {}): Member {
  return {
    id: 'user-sam',
    email: 'sam@example.com',
    name: 'Sam Lee',
    role: 'viewer',
    is_active: true,
    created_at: '2026-03-01T12:00:00Z',
    details: { totp_enabled: false, passkey_count: 0, last_sign_in_at: null },
    ...changes,
  }
}

export function makeInvitation(changes: Partial<Invitation> = {}): Invitation {
  return {
    id: 'invitation-riley',
    email: 'riley@example.com',
    name: 'Riley Chen',
    role: 'viewer',
    invited_by: 'Alex Morgan',
    created_at: '2026-09-24T12:00:00Z',
    expires_at: '2099-10-01T12:00:00Z',
    ...changes,
  }
}

export function makePasskey(changes: Partial<Passkey> = {}): Passkey {
  return {
    id: 'passkey-1',
    credential_id: 'credential-1',
    name: 'iCloud Keychain',
    provider: 'iCloud Keychain',
    backed_up: true,
    created_at: '2026-09-01T12:00:00Z',
    last_used_at: '2026-09-24T12:00:00Z',
    ...changes,
  }
}

export function makeDeviceSession(changes: Partial<SignedInSession> = {}): SignedInSession {
  return {
    id: 'session-1',
    device: 'Chrome on macOS',
    browser: 'Chrome',
    system: 'macOS',
    kind: 'desktop',
    ip_address: '192.0.2.20',
    remember: false,
    current: true,
    created_at: '2026-09-25T08:00:00Z',
    last_seen_at: '2026-09-25T09:00:00Z',
    ...changes,
  }
}

export function makeActivity(changes: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: 'activity-1',
    event: 'signed_in',
    created_at: '2026-09-25T09:00:00Z',
    user_name: 'Alex Morgan',
    actor_name: null,
    ip_address: '192.0.2.20',
    device: 'Chrome on macOS',
    details: { method: 'password' },
    ...changes,
  }
}
