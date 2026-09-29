import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import * as preferencesApi from '@/api/preferences'
import { notices } from '@/composables/notify'
import * as link from '@/plaid/link'
import { useConnectionsStore } from '@/stores/connections'
import { useHealthStore } from '@/stores/health'
import { usePreferencesStore } from '@/stores/preferences'
import {
  makeConnection,
  makeShared,
  makeSync,
  sharedCard,
  sharedChecking,
  sharedSavings,
  tartan,
} from '@/test/connections'
import { page } from '@/test/dom'
import { checking, seedFinance, visa } from '@/test/finance'
import { makePreferences, makeSystemInfo } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ConnectDialog from '@/views/connect/ConnectDialog.vue'

type Props = InstanceType<typeof ConnectDialog>['$props']

/** Plaid's answers for a new bank: two accounts shared, nothing imported yet. */
const linked = makeConnection({
  accounts: [
    { ...sharedCard, state: 'new', account_id: null },
    { ...sharedChecking, state: 'new' },
  ],
  history: 'pending',
  last_sync: null,
})
const token = { link_token: 'link-sandbox-1', expiration: '2026-09-27T16:00:00Z' }
const success = {
  connected: true as const,
  publicToken: 'public-sandbox-tartan-1',
  institution: 'Tartan Bank',
}

async function render(props: Partial<Props> = {}, { seed = true } = {}) {
  const open = ref(false)
  const Host = defineComponent({
    render: () =>
      h(ConnectDialog, {
        ...props,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
      }),
  })
  const { router } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      if (seed) seedFinance({ accounts: [checking, visa] })
      useHealthStore().system = makeSystemInfo({ configured: true })
    },
  })
  open.value = true
  await flushPromises()
  return { open, router }
}

const dialog = () => page().find('.v-overlay--active .app-dialog')
const find = (name: string) => dialog().find(`[data-test="${name}"]`)
const title = () => dialog().find('h2').text()

async function press(name: string) {
  await find(name).trigger('click')
  await flushPromises()
}

/** Plaid Link, which the test answers when it's ready. */
function linkWith(outcome: link.LinkOutcome = success) {
  vi.spyOn(link, 'loadLink').mockResolvedValue({ create: vi.fn() })
  return vi.spyOn(link, 'openLink').mockResolvedValue(outcome)
}

function names() {
  return dialog()
    .findAll('[data-test="account-picker-name"]')
    .map((name) => name.text())
}

function checked() {
  return dialog()
    .findAll('[data-test="account-picker-check"] input')
    .map((input) => (input.element as HTMLInputElement).checked)
}

describe('ConnectDialog', () => {
  it('explains connecting a bank, then brings in the chosen accounts', async () => {
    const newToken = vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    let answer: (outcome: link.LinkOutcome) => void = () => undefined
    vi.spyOn(link, 'loadLink').mockResolvedValue({ create: vi.fn() })
    const open = vi.spyOn(link, 'openLink').mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )
    const create = vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    const imported = makeConnection({
      accounts: [sharedCard, { ...sharedChecking, state: 'imported', account_id: 'account-bills' }],
      history: 'complete',
      last_sync: makeSync({ added: 1 }),
    })
    const choose = vi.spyOn(api, 'chooseAccounts').mockResolvedValue(imported)
    const { open: shown } = await render()

    expect(title()).toBe('Connect a bank')
    expect(find('connect-start').text()).toContain('sync every 6 hours')
    expect(find('connect-sandbox').text()).toContain('user_good')
    expect(dialog().find('[aria-current="step"]').text()).toContain('Sign in')
    dialog().findComponent({ name: 'VSelect' }).vm.$emit('update:modelValue', 365)
    await press('connect-continue')

    expect(newToken).toHaveBeenCalledWith(365)
    // Link covers the page, so the dialog steps aside until it's done.
    expect(dialog().exists()).toBe(false)
    expect(open).toHaveBeenCalledWith(token.link_token, undefined)
    expect(link.takePendingLink()).toMatchObject({ token: token.link_token, historyDays: 365 })
    link.rememberLink({
      token: token.link_token,
      purpose: 'connect',
      connectionId: null,
      historyDays: 365,
    })

    answer(success)
    await flushPromises()
    expect(create).toHaveBeenCalledWith('public-sandbox-tartan-1')
    expect(link.takePendingLink()).toBeNull()
    expect(useConnectionsStore().connections).toEqual([linked])
    expect(title()).toBe('Choose accounts to import')
    expect(dialog().text()).toContain('Tartan Bank shares 2 accounts')
    expect(dialog().find('[aria-current="step"]').text()).toContain('Choose accounts')
    expect(names()).toEqual(['Rewards Visa', 'Tartan Checking'])
    expect(checked()).toEqual([true, true])
    expect(find('account-picker-new').exists()).toBe(false)
    expect(find('connect-import').text()).toBe('Import 2 accounts')

    await dialog().findAll('[data-test="account-picker-rename"]')[1]!.trigger('click')
    await find('account-picker-name-field').find('input').setValue('  Bills ')
    await press('connect-import')

    expect(choose).toHaveBeenCalledWith(tartan.id, {
      accounts: [
        { id: sharedCard.id, name: 'Rewards Visa' },
        { id: sharedChecking.id, name: 'Bills' },
      ],
      removed: 'keep',
    })
    expect(title()).toBe('Tartan Bank is connected')
    expect(find('connect-done').text()).toContain('2 accounts imported')
    expect(find('connect-history-note').text()).toBe('Imported 1 transaction.')
    expect(dialog().find('[aria-current="step"]').exists()).toBe(false)

    await press('connect-finish')
    expect(shown.value).toBe(false)
  })

  it('shows progress while it works, and keeps the dialog open meanwhile', async () => {
    let tokenReady: (value: api.LinkToken) => void = () => undefined
    vi.spyOn(api, 'createLinkToken').mockReturnValue(
      new Promise((resolve) => {
        tokenReady = resolve
      }),
    )
    linkWith({ connected: false, error: null })
    await render()
    await press('connect-continue')
    expect(find('connect-progress').text()).toBe('Opening Plaid…')
    expect(find('dialog-close').attributes('disabled')).toBeDefined()
    tokenReady(token)
    await flushPromises()
    expect(find('connect-start').exists()).toBe(true)
  })

  it('says so when Plaid closes before a bank is connected', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    const open = linkWith({ connected: false, error: null })
    await render()

    await press('connect-continue')
    expect(title()).toBe('Connect a bank')
    expect(find('connect-notice').text()).toContain('Plaid closed before a bank was connected')

    open.mockResolvedValue({
      connected: false,
      error: {
        error_type: 'INSTITUTION_ERROR',
        error_code: 'INSTITUTION_DOWN',
        error_message: 'down',
        display_message: null,
      },
    })
    await press('connect-continue')
    expect(find('connect-notice').text()).toContain('INSTITUTION_DOWN')
    expect(link.takePendingLink()).toBeNull()
  })

  it('says why the bank could not be connected', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockRejectedValue(
      new ApiError(409, 'Tartan Bank is already connected.', { code: 'already_connected' }),
    )
    await render()
    await press('connect-continue')
    expect(find('connect-notice').text()).toBe('Tartan Bank is already connected.')
    expect(find('connect-start').exists()).toBe(true)
  })

  it('says nothing more when the person chose not to confirm it’s them', async () => {
    vi.spyOn(api, 'createLinkToken').mockRejectedValue(
      new ApiError(403, 'Confirm it’s you.', { code: 'verification_required' }),
    )
    await render()
    await press('connect-continue')
    expect(find('connect-notice').exists()).toBe(false)
  })

  it('says how a new bank’s history is coming along', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    vi.spyOn(api, 'chooseAccounts').mockResolvedValue(linked)
    const { router } = await render()

    await press('connect-continue')
    await press('connect-import')
    expect(find('connect-history-note').text()).toContain('Plaid is still fetching transactions')

    await press('connect-transactions')
    await vi.waitFor(() => {
      expect(router.currentRoute.value.path).toBe('/transactions')
    })
    expect(dialog().exists()).toBe(false)
  })

  it('reports the recent history when older transactions are still on their way', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    vi.spyOn(api, 'chooseAccounts').mockResolvedValue(
      makeConnection({ history: 'recent', last_sync: makeSync({ added: 40, updated: 0 }) }),
    )
    await render()
    await press('connect-continue')
    await press('connect-import')
    expect(find('connect-history-note').text()).toContain('Imported 40 transactions from the last')
  })

  it('says why nothing came in when the bank could not share its transactions', async () => {
    const why =
      'Plaid can’t get transactions from Tartan Bank right now (it’s down). Meanwhile, import a statement file.'
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    vi.spyOn(api, 'chooseAccounts').mockResolvedValue(
      makeConnection({
        status: 'error',
        error_code: 'BANK_DATA_UNAVAILABLE',
        error_message: why,
        last_sync: makeSync({ succeeded: false, added: 0, updated: 0 }),
      }),
    )
    await render()
    await press('connect-continue')
    await press('connect-import')

    const note = find('connect-history-note')
    expect(note.text()).toBe(why)
    expect(note.classes()).toContain('text-warning')
    expect(note.classes()).not.toContain('text-success')
  })

  it('goes back to the accounts when importing fails, and can be left for later', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(
      makeConnection({ accounts: [{ ...sharedSavings }], last_sync: null }),
    )
    vi.spyOn(api, 'chooseAccounts').mockRejectedValue(new ApiError(502, 'Plaid is down.'))
    const { open } = await render()
    await press('connect-continue')
    expect(dialog().text()).toContain('Tartan Bank shares 1 account.')
    expect(find('connect-import').text()).toBe('Import 1 account')

    await press('connect-import')
    expect(title()).toBe('Choose accounts to import')
    expect(find('connect-notice').text()).toBe('Plaid is down.')

    await find('account-picker-all').find('input').trigger('click')
    expect(find('connect-import').attributes('disabled')).toBeDefined()
    await press('connect-later')
    expect(open.value).toBe(false)
  })

  it('stays quiet when the import was cancelled at the check that it’s you', async () => {
    vi.spyOn(api, 'createLinkToken').mockResolvedValue(token)
    linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    vi.spyOn(api, 'chooseAccounts').mockRejectedValue(
      new ApiError(403, 'Confirm it’s you.', { code: 'verification_required' }),
    )
    await render()
    await press('connect-continue')
    await press('connect-import')
    expect(find('connect-notice').exists()).toBe(false)
  })

  it('changes which of a connected bank’s accounts are imported', async () => {
    const connection = makeConnection({ accounts: [sharedCard, sharedChecking, sharedSavings] })
    const saved = makeConnection({ id: connection.id })
    const choose = vi.spyOn(api, 'chooseAccounts').mockResolvedValue(saved)
    const { open } = await render({ connection })

    expect(title()).toBe('Choose accounts from Tartan Bank')
    expect(dialog().find('[aria-current="step"]').exists()).toBe(false)
    expect(checked()).toEqual([true, false, false])
    expect(find('account-picker-new').exists()).toBe(true)
    expect(find('connect-import').text()).toBe('Save')
    expect(find('connect-removed').exists()).toBe(false)

    const checks = dialog().findAll('[data-test="account-picker-check"] input')
    await checks[0]!.trigger('click')
    await checks[2]!.trigger('click')
    await flushPromises()
    expect(find('connect-removed').text()).toContain(
      'You’ve unticked an imported account. Its transactions:',
    )
    await find('connect-removed-delete').find('input').trigger('click')
    await press('connect-import')

    expect(choose).toHaveBeenCalledWith(connection.id, {
      accounts: [{ id: sharedSavings.id, name: 'Tartan Saving' }],
      removed: 'delete',
    })
    expect(notices.value.at(-1)?.text).toBe('Saved Tartan Bank’s accounts')
    expect(open.value).toBe(false)
  })

  it('counts the accounts that won’t be imported any more', async () => {
    const connection = makeConnection({
      accounts: [sharedCard, makeShared({ id: 'plaid-other', account_id: 'account-other' })],
    })
    await render({ connection })
    await find('account-picker-all').find('input').trigger('click')
    await flushPromises()
    expect(find('connect-removed').text()).toContain('You’ve unticked 2 imported accounts.')
    // Enter doesn't save until something is ticked.
    const choose = vi.spyOn(api, 'chooseAccounts').mockResolvedValue(connection)
    await dialog().find('[data-test="connect-accounts"]').trigger('submit')
    await flushPromises()
    expect(choose).not.toHaveBeenCalled()
    await dialog().findAll('[data-test="account-picker-check"] input')[1]!.trigger('click')
    await dialog().find('[data-test="connect-accounts"]').trigger('submit')
    await flushPromises()
    expect(choose).toHaveBeenCalledWith(connection.id, {
      accounts: [{ id: 'plaid-other', name: 'Rewards Visa' }],
      removed: 'keep',
    })
  })

  it('picks up after a bank’s own sign-in page sent people back', async () => {
    const newToken = vi.spyOn(api, 'createLinkToken')
    const open = linkWith()
    vi.spyOn(api, 'createConnection').mockResolvedValue(linked)
    const load = vi.spyOn(preferencesApi, 'fetchPreferences').mockResolvedValue(makePreferences())
    await render(
      {
        resume: {
          token: 'link-kept',
          historyDays: null,
          redirectUri: 'https://x.test/connect/oauth',
        },
      },
      { seed: false },
    )

    expect(newToken).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('link-kept', 'https://x.test/connect/oauth')
    expect(load).toHaveBeenCalled()
    expect(title()).toBe('Choose accounts to import')
  })

  it('describes syncing before the household’s preferences load, and closes', async () => {
    vi.spyOn(preferencesApi, 'fetchPreferences').mockReturnValue(new Promise(() => undefined))
    const { open } = await render({}, { seed: false })
    expect(find('connect-start').text()).toContain('sync every 6 hours')
    await press('dialog-close')
    expect(open.value).toBe(false)
  })

  it('offers syncing by hand when automatic sync is off', async () => {
    await render()
    const preferences = usePreferencesStore()
    preferences.saved = {
      ...makePreferences(),
      sync: { ...makePreferences().sync, auto_sync: false },
    }
    await flushPromises()
    expect(find('connect-start').text()).toContain('Sync from the Connect tab')
    useHealthStore().system = makeSystemInfo({ configured: true, environment: 'production' })
    await flushPromises()
    expect(find('connect-sandbox').exists()).toBe(false)
    await press('connect-cancel')
    expect(dialog().exists()).toBe(false)
  })
})
