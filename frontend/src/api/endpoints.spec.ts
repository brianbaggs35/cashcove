import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/browser'

import * as account from '@/api/account'
import * as accounts from '@/api/accounts'
import * as ai from '@/api/ai'
import * as auth from '@/api/auth'
import * as budget from '@/api/budget'
import * as categories from '@/api/categories'
import * as connections from '@/api/connections'
import * as dashboard from '@/api/dashboard'
import * as imports from '@/api/imports'
import * as preferences from '@/api/preferences'
import * as system from '@/api/system'
import * as transactions from '@/api/transactions'
import * as users from '@/api/users'
import { makePreferences } from '@/test/fixtures'

const assertion = { id: 'credential' } as AuthenticationResponseJSON
const attestation = { id: 'credential' } as RegistrationResponseJSON
const accountInput: accounts.AccountInput = {
  name: 'Rainy day fund',
  type: 'savings',
  institution: null,
  mask: null,
  balance: '2500.00',
  credit_limit: null,
  notes: null,
}
const transactionInput: transactions.TransactionInput = {
  account_id: 'a1',
  date: '2026-09-20',
  amount: '-42.50',
  payee: 'Corner Market',
  category_id: null,
  notes: null,
}

const importRequest: imports.ImportRequest = {
  file_name: 'a.csv',
  content: 'YQ==',
  profile_id: null,
  statement: 0,
  options: {
    date_order: 'mdy',
    decimal_mark: '.',
    flip: false,
    payee_field: 'name',
    csv: null,
  },
  account_id: 'a1',
  lines: [2, 3],
  balance: 'move',
  save_profile: { id: null, name: 'Harbor checking' },
}

// Each API function, the request it should make, and the body it should send.
const endpoints: [string, () => Promise<unknown>, string, string, unknown][] = [
  ['fetchSession', () => auth.fetchSession(), 'GET', '/auth/session', undefined],
  [
    'fetchDashboard',
    () => dashboard.fetchDashboard('2026-09-20'),
    'GET',
    '/dashboard?today=2026-09-20',
    undefined,
  ],
  [
    'fetchBudgets',
    () => budget.fetchBudgets('2026-09-20'),
    'GET',
    '/budgets?today=2026-09-20',
    undefined,
  ],
  [
    'createBudget',
    () => budget.createBudget({ name: 'Monthly', period: 'monthly', amount: '2000.00' }),
    'POST',
    '/budgets',
    { name: 'Monthly', period: 'monthly', amount: '2000.00' },
  ],
  [
    'updateBudget',
    () => budget.updateBudget('b1', { amount: '2500.00', today: '2026-10-05' }),
    'PATCH',
    '/budgets/b1',
    { amount: '2500.00', today: '2026-10-05' },
  ],
  ['deleteBudget', () => budget.deleteBudget('b1'), 'DELETE', '/budgets/b1', undefined],
  [
    'fetchBudgetPeriod',
    () => budget.fetchBudgetPeriod('b1', { today: '2026-09-20' }),
    'GET',
    '/budgets/b1/period?today=2026-09-20',
    undefined,
  ],
  [
    'fetchBudgetPeriod on a day',
    () => budget.fetchBudgetPeriod('b1', { on: '2026-08-10', today: '2026-09-20' }),
    'GET',
    '/budgets/b1/period?on=2026-08-10&today=2026-09-20',
    undefined,
  ],
  [
    'fetchBudgetHistory',
    () => budget.fetchBudgetHistory('b1', { on: '2026-08-10', today: '2026-09-20' }, 6),
    'GET',
    '/budgets/b1/history?on=2026-08-10&today=2026-09-20&count=6',
    undefined,
  ],
  [
    'fetchBudgetHistory by default',
    () => budget.fetchBudgetHistory('b1', { today: '2026-09-20' }),
    'GET',
    '/budgets/b1/history?today=2026-09-20&count=12',
    undefined,
  ],
  [
    'fetchBudgetTransactions',
    () =>
      budget.fetchBudgetTransactions('b1', {
        today: '2026-09-20',
        kind: 'income',
        removed: true,
        page: 2,
        pageSize: 10,
      }),
    'GET',
    '/budgets/b1/transactions?today=2026-09-20&kind=income&removed=true&page=2&page_size=10',
    undefined,
  ],
  [
    'linkBudgetTransactions',
    () => budget.linkBudgetTransactions('b1', ['t1', 't2'], 'spending'),
    'POST',
    '/budgets/b1/transactions',
    { ids: ['t1', 't2'], kind: 'spending' },
  ],
  [
    'unlinkBudgetTransaction',
    () => budget.unlinkBudgetTransaction('b1', 't1'),
    'DELETE',
    '/budgets/b1/transactions/t1',
    undefined,
  ],
  [
    'addBudgetSource',
    () => budget.addBudgetSource('b1', { kind: 'income', category_id: 'c1' }),
    'POST',
    '/budgets/b1/sources',
    { kind: 'income', category_id: 'c1' },
  ],
  [
    'removeBudgetSource',
    () => budget.removeBudgetSource('b1', 's1'),
    'DELETE',
    '/budgets/b1/sources/s1',
    undefined,
  ],
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
  ['fetchAccounts', () => accounts.fetchAccounts(), 'GET', '/accounts', undefined],
  ['createAccount', () => accounts.createAccount(accountInput), 'POST', '/accounts', accountInput],
  [
    'updateAccount',
    () => accounts.updateAccount('a1', { closed: true }),
    'PATCH',
    '/accounts/a1',
    { closed: true },
  ],
  ['deleteAccount', () => accounts.deleteAccount('a1'), 'DELETE', '/accounts/a1', undefined],
  ['fetchCategories', () => categories.fetchCategories(), 'GET', '/categories', undefined],
  [
    'addSuggestedCategories',
    () => categories.addSuggestedCategories(),
    'POST',
    '/categories/suggested',
    undefined,
  ],
  [
    'createGroup',
    () => categories.createGroup({ name: 'Hobbies', kind: 'expense' }),
    'POST',
    '/categories/groups',
    { name: 'Hobbies', kind: 'expense' },
  ],
  [
    'updateGroup',
    () => categories.updateGroup('g1', { name: 'Fun' }),
    'PATCH',
    '/categories/groups/g1',
    { name: 'Fun' },
  ],
  ['deleteGroup', () => categories.deleteGroup('g1'), 'DELETE', '/categories/groups/g1', undefined],
  [
    'createCategory',
    () => categories.createCategory({ group_id: 'g1', name: 'Yarn', emoji: '🧶' }),
    'POST',
    '/categories',
    { group_id: 'g1', name: 'Yarn', emoji: '🧶' },
  ],
  [
    'updateCategory',
    () => categories.updateCategory('c1', { emoji: '🎨' }),
    'PATCH',
    '/categories/c1',
    { emoji: '🎨' },
  ],
  ['deleteCategory', () => categories.deleteCategory('c1'), 'DELETE', '/categories/c1', undefined],
  [
    'deleteCategory moving its transactions',
    () => categories.deleteCategory('c1', 'c2'),
    'DELETE',
    '/categories/c1?move_to=c2',
    undefined,
  ],
  ['fetchTransactions', () => transactions.fetchTransactions(), 'GET', '/transactions', undefined],
  [
    'fetchTransactions with filters',
    () =>
      transactions.fetchTransactions({
        q: 'coffee',
        account_id: ['a1', 'a2'],
        uncategorized: true,
        page: 2,
      }),
    'GET',
    '/transactions?q=coffee&account_id=a1&account_id=a2&uncategorized=true&page=2',
    undefined,
  ],
  [
    'fetchTransaction',
    () => transactions.fetchTransaction('t1'),
    'GET',
    '/transactions/t1',
    undefined,
  ],
  [
    'fetchPayees',
    () => transactions.fetchPayees(' whole '),
    'GET',
    '/transactions/payees?q=whole&limit=8',
    undefined,
  ],
  [
    'createTransaction',
    () => transactions.createTransaction(transactionInput),
    'POST',
    '/transactions',
    transactionInput,
  ],
  [
    'updateTransaction',
    () => transactions.updateTransaction('t1', { payee: 'Market' }),
    'PATCH',
    '/transactions/t1',
    { payee: 'Market' },
  ],
  [
    'deleteTransaction',
    () => transactions.deleteTransaction('t1'),
    'DELETE',
    '/transactions/t1',
    undefined,
  ],
  [
    'deleteTransactions',
    () => transactions.deleteTransactions(['t1', 't2']),
    'POST',
    '/transactions/bulk/delete',
    { ids: ['t1', 't2'] },
  ],
  [
    'categorizeTransactions',
    () => transactions.categorizeTransactions(['t1'], null),
    'POST',
    '/transactions/bulk/categorize',
    { ids: ['t1'], category_id: null },
  ],
  ['fetchConnections', () => connections.fetchConnections(), 'GET', '/connections', undefined],
  ['fetchConnection', () => connections.fetchConnection('c1'), 'GET', '/connections/c1', undefined],
  [
    'createLinkToken',
    () => connections.createLinkToken(365),
    'POST',
    '/connections/link-token',
    { history_days: 365 },
  ],
  [
    'createLinkToken without a history length',
    () => connections.createLinkToken(),
    'POST',
    '/connections/link-token',
    { history_days: null },
  ],
  [
    'createConnection',
    () => connections.createConnection('public-sandbox-1'),
    'POST',
    '/connections',
    { public_token: 'public-sandbox-1' },
  ],
  [
    'chooseAccounts',
    () => connections.chooseAccounts('c1', { accounts: [{ id: 'p1', name: 'Bills' }] }),
    'PUT',
    '/connections/c1/accounts',
    { accounts: [{ id: 'p1', name: 'Bills' }] },
  ],
  [
    'updateLinkToken',
    () => connections.updateLinkToken('c1', 'accounts'),
    'POST',
    '/connections/c1/link-token',
    { mode: 'accounts' },
  ],
  [
    'syncConnection',
    () => connections.syncConnection('c1'),
    'POST',
    '/connections/c1/sync',
    { reason: 'manual' },
  ],
  [
    'syncConnection after reconnecting',
    () => connections.syncConnection('c1', 'reconnected'),
    'POST',
    '/connections/c1/sync',
    { reason: 'reconnected' },
  ],
  ['fetchSyncs', () => connections.fetchSyncs('c1'), 'GET', '/connections/c1/syncs', undefined],
  [
    'deleteConnection',
    () => connections.deleteConnection('c1', false),
    'DELETE',
    '/connections/c1?keep_accounts=false',
    undefined,
  ],
  [
    'previewImport',
    () => imports.previewImport({ file_name: 'a.csv', content: 'YQ==', account_id: 'a1' }),
    'POST',
    '/imports/preview',
    { file_name: 'a.csv', content: 'YQ==', account_id: 'a1' },
  ],
  ['createImport', () => imports.createImport(importRequest), 'POST', '/imports', importRequest],
  ['fetchImports', () => imports.fetchImports(), 'GET', '/imports', undefined],
  ['undoImport', () => imports.undoImport('i1'), 'DELETE', '/imports/i1', undefined],
  ['fetchSavedFormats', () => imports.fetchSavedFormats(), 'GET', '/imports/profiles', undefined],
  [
    'renameSavedFormat',
    () => imports.renameSavedFormat('p1', 'Harbor checking'),
    'PATCH',
    '/imports/profiles/p1',
    { name: 'Harbor checking' },
  ],
  [
    'deleteSavedFormat',
    () => imports.deleteSavedFormat('p1'),
    'DELETE',
    '/imports/profiles/p1',
    undefined,
  ],
]

const connection: ai.AiConnectionInput = {
  provider: 'ollama_local',
  base_url: 'http://host.docker.internal:11434',
  api_key: null,
  model: null,
}

// What the AI tab and Settings > AI ask of the API.
const aiEndpoints: typeof endpoints = [
  ['fetchAiProviders', () => ai.fetchAiProviders(), 'GET', '/ai/providers', undefined],
  ['fetchAiSettings', () => ai.fetchAiSettings(), 'GET', '/ai/settings', undefined],
  [
    'saveAiSettings',
    () =>
      ai.saveAiSettings({
        provider: 'openai',
        model: 'gpt-6-luna',
        base_url: null,
        api_key: 'sk-test-key-12345',
        review_imports: true,
      }),
    'PUT',
    '/ai/settings',
    {
      provider: 'openai',
      model: 'gpt-6-luna',
      base_url: null,
      api_key: 'sk-test-key-12345',
      review_imports: true,
    },
  ],
  ['removeAiSettings', () => ai.removeAiSettings(), 'DELETE', '/ai/settings', undefined],
  ['fetchAiModels', () => ai.fetchAiModels(connection), 'POST', '/ai/models', connection],
  ['testAiConnection', () => ai.testAiConnection(connection), 'POST', '/ai/test', connection],
  [
    'askAi',
    () => ai.askAi([{ role: 'user', content: 'How much on coffee?' }], '2026-09-20'),
    'POST',
    '/ai/chat',
    { messages: [{ role: 'user', content: 'How much on coffee?' }], today: '2026-09-20' },
  ],
  [
    'readStatementWithAi',
    () => ai.readStatementWithAi({ file_name: 'september.pdf', content: 'JVBERi0xLjc=' }),
    'POST',
    '/ai/statements',
    { file_name: 'september.pdf', content: 'JVBERi0xLjc=' },
  ],
  [
    'startAiReview',
    () => ai.startAiReview({ scope: 'recent', days: 30, limit: 50, today: '2026-09-20' }),
    'POST',
    '/ai/reviews',
    { scope: 'recent', days: 30, limit: 50, today: '2026-09-20' },
  ],
  ['fetchAiReviews', () => ai.fetchAiReviews(), 'GET', '/ai/reviews', undefined],
  ['fetchAiReview', () => ai.fetchAiReview('r1'), 'GET', '/ai/reviews/r1', undefined],
  [
    'fetchRecommendations',
    () => ai.fetchRecommendations(),
    'GET',
    '/ai/recommendations',
    undefined,
  ],
  [
    'fetchRecommendations with a query',
    () => ai.fetchRecommendations({ status: 'applied', review_id: 'r1', page: 2, page_size: 20 }),
    'GET',
    '/ai/recommendations?status=applied&review_id=r1&page=2&page_size=20',
    undefined,
  ],
  [
    'applyRecommendations',
    () => ai.applyRecommendations(['a', 'b']),
    'POST',
    '/ai/recommendations/apply',
    { ids: ['a', 'b'] },
  ],
  [
    'dismissRecommendations',
    () => ai.dismissRecommendations(['a']),
    'POST',
    '/ai/recommendations/dismiss',
    { ids: ['a'] },
  ],
  ['fetchAiUsage', () => ai.fetchAiUsage(30), 'GET', '/ai/usage?days=30', undefined],
]

describe('API endpoints', () => {
  it.each([...endpoints, ...aiEndpoints])('%s', async (_, call, method, path, body) => {
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

describe('queryString', () => {
  it('repeats lists and leaves out empty values', () => {
    expect(
      transactions.queryString({
        q: '',
        account_id: [],
        category_id: ['c1', 'c2'],
        uncategorized: false,
        start: undefined,
        min_amount: null,
        sort: '-amount',
      }),
    ).toBe('?category_id=c1&category_id=c2&sort=-amount')
    expect(transactions.queryString({})).toBe('')
  })
})
