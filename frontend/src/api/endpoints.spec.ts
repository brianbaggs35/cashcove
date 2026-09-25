import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'

import * as account from '@/api/account'
import * as auth from '@/api/auth'
import * as preferences from '@/api/preferences'
import * as system from '@/api/system'
import * as users from '@/api/users'
import { makePreferences } from '@/test/fixtures'

const assertion = { id: 'credential' } as AuthenticationResponseJSON
const attestation = { id: 'credential' } as RegistrationResponseJSON

// Each API function, the request it should make, and the body it should send.
const endpoints: [string, () => Promise<unknown>, string, string, unknown][] = [
  ['fetchSession', () => auth.fetchSession(), 'GET', '/auth/session', undefined],
  [
    'checkSetupCode',
    () => auth.checkSetupCode('ABCD'),
    'POST',
    '/auth/setup/check',
    { setup_code: 'ABCD' },
  ],
  [
    'completeSetup',
    () => auth.completeSetup({ setup_code: 'ABCD', name: 'Alex', email: 'a@x.co', password: 'pw' }),
    'POST',
    '/auth/setup',
    { setup_code: 'ABCD', name: 'Alex', email: 'a@x.co', password: 'pw' },
  ],
  [
    'signIn',
    () => auth.signIn('a@x.co', 'pw', true),
    'POST',
    '/auth/sign-in',
    { email: 'a@x.co', password: 'pw', remember: true },
  ],
  [
    'signInWithTotp',
    () => auth.signInWithTotp('123456'),
    'POST',
    '/auth/sign-in/totp',
    { code: '123456' },
  ],
  [
    'signInWithRecoveryCode',
    () => auth.signInWithRecoveryCode('abcd-efgh'),
    'POST',
    '/auth/sign-in/recovery-code',
    { code: 'abcd-efgh' },
  ],
  [
    'secondStepPasskeyOptions',
    () => auth.secondStepPasskeyOptions(),
    'POST',
    '/auth/sign-in/passkey/options',
    undefined,
  ],
  [
    'signInSecondStepWithPasskey',
    () => auth.signInSecondStepWithPasskey('challenge', assertion),
    'POST',
    '/auth/sign-in/passkey',
    { challenge_id: 'challenge', credential: assertion },
  ],
  [
    'passkeySignInOptions',
    () => auth.passkeySignInOptions(),
    'POST',
    '/auth/passkey/options',
    undefined,
  ],
  [
    'signInWithPasskey',
    () => auth.signInWithPasskey('challenge', assertion, false),
    'POST',
    '/auth/passkey',
    { challenge_id: 'challenge', credential: assertion, remember: false },
  ],
  ['signOut', () => auth.signOut(), 'POST', '/auth/sign-out', undefined],
  [
    'previewInvitation',
    () => auth.previewInvitation('token'),
    'POST',
    '/auth/invitations/preview',
    { token: 'token' },
  ],
  [
    'acceptInvitation',
    () => auth.acceptInvitation('token', 'Sam', 'pw'),
    'POST',
    '/auth/invitations/accept',
    { token: 'token', name: 'Sam', password: 'pw' },
  ],
  [
    'previewPasswordReset',
    () => auth.previewPasswordReset('token'),
    'POST',
    '/auth/password-resets/preview',
    { token: 'token' },
  ],
  [
    'completePasswordReset',
    () => auth.completePasswordReset('token', 'pw'),
    'POST',
    '/auth/password-resets/complete',
    { token: 'token', password: 'pw' },
  ],

  [
    'verifyWithPassword',
    () => account.verifyWithPassword('pw'),
    'POST',
    '/account/verify/password',
    { password: 'pw' },
  ],
  [
    'verifyWithTotp',
    () => account.verifyWithTotp('123456'),
    'POST',
    '/account/verify/totp',
    { code: '123456' },
  ],
  [
    'verifyWithPasskeyOptions',
    () => account.verifyWithPasskeyOptions(),
    'POST',
    '/account/verify/passkey/options',
    undefined,
  ],
  [
    'verifyWithPasskey',
    () => account.verifyWithPasskey('challenge', assertion),
    'POST',
    '/account/verify/passkey',
    { challenge_id: 'challenge', credential: assertion },
  ],
  ['fetchAccount', () => account.fetchAccount(), 'GET', '/account', undefined],
  [
    'updateProfile',
    () => account.updateProfile('Alex', 'a@x.co'),
    'PUT',
    '/account/profile',
    { name: 'Alex', email: 'a@x.co' },
  ],
  [
    'changePassword',
    () => account.changePassword('old', 'new'),
    'POST',
    '/account/password',
    { current_password: 'old', new_password: 'new' },
  ],
  ['startTotpSetup', () => account.startTotpSetup(), 'POST', '/account/totp', undefined],
  [
    'confirmTotpSetup',
    () => account.confirmTotpSetup('123456'),
    'POST',
    '/account/totp/confirm',
    { code: '123456' },
  ],
  ['turnOffTotp', () => account.turnOffTotp(), 'DELETE', '/account/totp', undefined],
  [
    'createRecoveryCodes',
    () => account.createRecoveryCodes(),
    'POST',
    '/account/recovery-codes',
    undefined,
  ],
  ['fetchPasskeys', () => account.fetchPasskeys(), 'GET', '/account/passkeys', undefined],
  [
    'passkeyRegistrationOptions',
    () => account.passkeyRegistrationOptions(),
    'POST',
    '/account/passkeys/options',
    undefined,
  ],
  [
    'addPasskey',
    () => account.addPasskey('challenge', attestation, 'Laptop'),
    'POST',
    '/account/passkeys',
    { challenge_id: 'challenge', credential: attestation, name: 'Laptop' },
  ],
  [
    'addPasskey without a name',
    () => account.addPasskey('challenge', attestation),
    'POST',
    '/account/passkeys',
    { challenge_id: 'challenge', credential: attestation, name: '' },
  ],
  [
    'renamePasskey',
    () => account.renamePasskey('p1', 'Phone'),
    'PATCH',
    '/account/passkeys/p1',
    { name: 'Phone' },
  ],
  ['removePasskey', () => account.removePasskey('p1'), 'DELETE', '/account/passkeys/p1', undefined],
  ['fetchSessions', () => account.fetchSessions(), 'GET', '/account/sessions', undefined],
  ['endSession', () => account.endSession('s1'), 'DELETE', '/account/sessions/s1', undefined],
  [
    'endOtherSessions',
    () => account.endOtherSessions(),
    'POST',
    '/account/sessions/sign-out-others',
    undefined,
  ],
  ['fetchActivity', () => account.fetchActivity(), 'GET', '/account/activity?limit=50', undefined],
  [
    'fetchActivity with a limit',
    () => account.fetchActivity(5),
    'GET',
    '/account/activity?limit=5',
    undefined,
  ],

  ['fetchMembers', () => users.fetchMembers(), 'GET', '/users', undefined],
  [
    'updateMember',
    () => users.updateMember('u1', { role: 'admin' }),
    'PATCH',
    '/users/u1',
    { role: 'admin' },
  ],
  ['removeMember', () => users.removeMember('u1'), 'DELETE', '/users/u1', undefined],
  [
    'createResetLink',
    () => users.createResetLink('u1'),
    'POST',
    '/users/u1/password-reset',
    undefined,
  ],
  ['resetTwoFactor', () => users.resetTwoFactor('u1'), 'DELETE', '/users/u1/two-factor', undefined],
  [
    'fetchHouseholdActivity',
    () => users.fetchHouseholdActivity(),
    'GET',
    '/users/activity?limit=100',
    undefined,
  ],
  [
    'fetchHouseholdActivity with a limit',
    () => users.fetchHouseholdActivity(10),
    'GET',
    '/users/activity?limit=10',
    undefined,
  ],
  ['fetchInvitations', () => users.fetchInvitations(), 'GET', '/users/invitations', undefined],
  [
    'inviteMember',
    () => users.inviteMember('Riley', 'r@x.co', 'viewer'),
    'POST',
    '/users/invitations',
    { name: 'Riley', email: 'r@x.co', role: 'viewer' },
  ],
  [
    'renewInvitation',
    () => users.renewInvitation('i1'),
    'POST',
    '/users/invitations/i1/link',
    undefined,
  ],
  [
    'revokeInvitation',
    () => users.revokeInvitation('i1'),
    'DELETE',
    '/users/invitations/i1',
    undefined,
  ],

  ['fetchPreferences', () => preferences.fetchPreferences(), 'GET', '/settings', undefined],
  [
    'savePreferences',
    () => preferences.savePreferences(makePreferences()),
    'PUT',
    '/settings',
    makePreferences(),
  ],
  ['fetchSystemInfo', () => system.fetchSystemInfo(), 'GET', '/system', undefined],
]

describe('API endpoints', () => {
  it.each(endpoints)('%s', async (_, call, method, path, body) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
    vi.stubGlobal('fetch', fetchMock)
    await call()
    const [url, init] = fetchMock.mock.lastCall as [string, RequestInit]
    expect(url).toBe(`/api${path}`)
    expect(init.method).toBe(method)
    expect(init.body === undefined ? undefined : JSON.parse(init.body as string)).toEqual(body)
  })
})
