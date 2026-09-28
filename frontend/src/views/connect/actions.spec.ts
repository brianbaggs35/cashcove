import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import { notices } from '@/composables/notify'
import * as link from '@/plaid/link'
import { useConnectionsStore } from '@/stores/connections'
import { fidelity, makeConnection, makeSync, tartan } from '@/test/connections'
import { relink, syncChanges, syncNow } from '@/views/connect/actions'

const lastNotice = () => notices.value.at(-1)
const cancelled = new ApiError(403, 'Confirm it’s you.', { code: 'verification_required' })

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('syncChanges', () => {
  it.each([
    [{ added: 0, updated: 0, removed: 0 }, null],
    [{ added: 1, updated: 0, removed: 0 }, '1 new transaction'],
    [{ added: 3, updated: 1, removed: 0 }, '3 new transactions and 1 updated'],
    [{ added: 2, updated: 1, removed: 4 }, '2 new transactions, 1 updated and 4 removed'],
    [{ added: 0, updated: 0, removed: 1 }, '1 removed'],
  ])('%o reads as %s', (sync, text) => {
    expect(syncChanges(sync)).toBe(text)
  })
})

describe('syncNow', () => {
  it('says what the sync brought in', async () => {
    const synced = makeConnection({ last_sync: makeSync({ id: 'sync-2', added: 2, updated: 0 }) })
    vi.spyOn(api, 'syncConnection').mockResolvedValue(synced)
    await syncNow(tartan)
    expect(useConnectionsStore().connections).toEqual([synced])
    expect(lastNotice()).toMatchObject({
      text: 'Synced Tartan Bank: 2 new transactions',
      tone: 'success',
    })
  })

  it('says when there was nothing new', async () => {
    vi.spyOn(api, 'syncConnection').mockResolvedValue(
      makeConnection({ last_sync: makeSync({ added: 0, updated: 0 }) }),
    )
    await syncNow(tartan)
    expect(lastNotice()?.text).toBe('Synced Tartan Bank. Nothing new.')
  })

  it('says why the sync failed', async () => {
    vi.spyOn(api, 'syncConnection').mockResolvedValue(fidelity)
    await syncNow(fidelity)
    expect(lastNotice()).toMatchObject({ text: fidelity.error_message, tone: 'error' })

    vi.spyOn(api, 'syncConnection').mockResolvedValue(
      makeConnection({ status: 'error', error_message: null, last_sync: null }),
    )
    await syncNow(tartan)
    expect(lastNotice()?.text).toBe("Couldn't sync Tartan Bank.")
  })

  it('catches up when the bank is already syncing', async () => {
    vi.spyOn(api, 'syncConnection').mockRejectedValue(
      new ApiError(409, 'Tartan Bank is already syncing.', { code: 'already_syncing' }),
    )
    const fetch = vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
    await syncNow(tartan)
    expect(lastNotice()).toMatchObject({ text: 'Tartan Bank is already syncing.', tone: 'info' })
    expect(fetch).toHaveBeenCalled()
  })

  it('reports other failures, but not a cancelled check that it’s you', async () => {
    const sync = vi
      .spyOn(api, 'syncConnection')
      .mockRejectedValue(new ApiError(502, 'Plaid is down.', { code: 'plaid_error' }))
    await syncNow(tartan)
    expect(lastNotice()).toMatchObject({ text: 'Plaid is down.', tone: 'error' })

    notices.value = []
    sync.mockRejectedValue(cancelled)
    await syncNow(tartan)
    expect(notices.value).toEqual([])
  })
})

describe('relink', () => {
  const token = { link_token: 'link-sandbox-update', expiration: '2026-09-27T16:00:00Z' }

  it('signs in to the bank again through Plaid, then syncs', async () => {
    const newToken = vi.spyOn(api, 'updateLinkToken').mockResolvedValue(token)
    const remember = vi.spyOn(link, 'rememberLink')
    const open = vi
      .spyOn(link, 'openLink')
      .mockResolvedValue({ connected: true, publicToken: 'public-sandbox-1', institution: null })
    const healthy = makeConnection({ id: fidelity.id, institution_name: 'Fidelity' })
    const sync = vi.spyOn(api, 'syncConnection').mockResolvedValue(healthy)

    expect(await relink(fidelity, 'reconnect')).toEqual(healthy)

    expect(newToken).toHaveBeenCalledWith(fidelity.id, 'reconnect')
    expect(remember).toHaveBeenCalledWith({
      token: token.link_token,
      purpose: 'reconnect',
      connectionId: fidelity.id,
      historyDays: null,
    })
    expect(open).toHaveBeenCalledWith(token.link_token, undefined)
    expect(sync).toHaveBeenCalledWith(fidelity.id, 'reconnected')
    expect(link.takePendingLink()).toBeNull()
    expect(useConnectionsStore().connections).toEqual([healthy])
    expect(lastNotice()?.text).toBe('Reconnected Fidelity: 1 new transaction and 1 updated')
  })

  it('picks up after a bank’s own sign-in page, and leaves new accounts to be chosen', async () => {
    const newToken = vi.spyOn(api, 'updateLinkToken')
    const open = vi
      .spyOn(link, 'openLink')
      .mockResolvedValue({ connected: true, publicToken: 'public-sandbox-1', institution: null })
    vi.spyOn(api, 'syncConnection').mockResolvedValue(tartan)

    const resume = { token: 'link-sandbox-kept', redirectUri: 'https://x.test/connect/oauth' }
    expect(await relink(tartan, 'accounts', resume)).toEqual(tartan)

    expect(newToken).not.toHaveBeenCalled()
    expect(open).toHaveBeenCalledWith('link-sandbox-kept', 'https://x.test/connect/oauth')
    expect(notices.value).toEqual([])
  })

  it('does nothing more when Plaid closes without signing in', async () => {
    vi.spyOn(api, 'updateLinkToken').mockResolvedValue(token)
    const open = vi.spyOn(link, 'openLink').mockResolvedValue({ connected: false, error: null })
    const sync = vi.spyOn(api, 'syncConnection')

    expect(await relink(fidelity, 'reconnect')).toBeNull()
    expect(notices.value).toEqual([])

    open.mockResolvedValue({
      connected: false,
      error: {
        error_type: 'ITEM_ERROR',
        error_code: 'INVALID_CREDENTIALS',
        error_message: 'wrong',
        display_message: 'Wrong password.',
      },
    })
    expect(await relink(fidelity, 'reconnect')).toBeNull()
    expect(lastNotice()).toMatchObject({ text: 'Wrong password.', tone: 'error' })
    expect(sync).not.toHaveBeenCalled()
  })

  it('reports what went wrong, forgetting the Link it opened', async () => {
    vi.spyOn(api, 'updateLinkToken').mockResolvedValue(token)
    vi.spyOn(link, 'openLink').mockRejectedValue(new Error("Couldn't load Plaid."))

    expect(await relink(fidelity, 'reconnect')).toBeNull()
    expect(lastNotice()).toMatchObject({ text: "Couldn't load Plaid.", tone: 'error' })
    expect(link.takePendingLink()).toBeNull()

    notices.value = []
    vi.spyOn(api, 'updateLinkToken').mockRejectedValue(cancelled)
    expect(await relink(fidelity, 'reconnect')).toBeNull()
    expect(notices.value).toEqual([])
  })
})
