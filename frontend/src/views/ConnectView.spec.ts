import { flushPromises } from '@vue/test-utils'

import * as healthApi from '@/api/health'
import * as systemApi from '@/api/system'
import { ApiError } from '@/api/client'
import * as api from '@/api/connections'
import { notices } from '@/composables/notify'
import * as link from '@/plaid/link'
import { SYNCING_POLL, useConnectionsStore } from '@/stores/connections'
import { useHealthStore } from '@/stores/health'
import { usePreferencesStore } from '@/stores/preferences'
import { fidelity, makeConnection, sharedCard, sharedSavings, tartan } from '@/test/connections'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import {
  healthyReport,
  makePreferences,
  makeSessionState,
  makeSystemInfo,
  makeUser,
} from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import * as actions from '@/views/connect/actions'
import ConnectView from '@/views/ConnectView.vue'

interface RenderOptions {
  role?: 'admin' | 'viewer'
  configured?: boolean | null
  route?: string
}

async function render({ role = 'admin', configured = true, route }: RenderOptions = {}) {
  const mounted = await mountWithPlugins(ConnectView, {
    width: 1280,
    route,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance()
      if (configured !== null) useHealthStore().system = makeSystemInfo({ configured })
    },
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

const dialogTitle = () => page().find('.v-overlay--active .app-dialog h2').text()

describe('ConnectView', () => {
  it('shows the connected banks at a glance, then each one', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan, fidelity])
    const { find, wrapper } = await render()

    expect(find('connect-add').text()).toBe('Connect a bank')
    expect(find('read-only-notice').exists()).toBe(false)
    expect(find('plaid-setup').exists()).toBe(false)
    expect(find('connect-summary-banks').text()).toBe('2')
    expect(find('connect-summary-health').text()).toBe('1 needs attention')
    expect(find('connect-summary-accounts').text()).toBe('2')
    expect(find('connect-summary').text()).toContain('of 3 shared')
    expect(find('connect-summary-next').text()).not.toBe('Not scheduled')
    expect(wrapper.findAll('[data-test="connection-name"]').map((name) => name.text())).toEqual([
      'Fidelity',
      'Tartan Bank',
    ])
    expect(find('connect-privacy').text()).toContain('never sees your bank passwords')
  })

  it('shows a skeleton until the banks load, and offers to try again if they don’t', async () => {
    let fail: (error: Error) => void = () => undefined
    const fetch = vi.spyOn(api, 'fetchConnections').mockReturnValue(
      new Promise((_, reject) => {
        fail = reject
      }),
    )
    const { find } = await render()
    expect(find('connections-loading').exists()).toBe(true)

    fail(new ApiError(0, 'Offline.'))
    await flushPromises()
    expect(find('connections-error').text()).toContain(
      "Couldn't load your connected banks. Offline.",
    )
    fetch.mockResolvedValue([])
    await find('connections-retry').trigger('click')
    await flushPromises()
    expect(find('connect-intro').exists()).toBe(true)
  })

  it('invites admins to connect their first bank', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
    const { find } = await render()
    expect(find('connect-add').exists()).toBe(false)
    expect(find('connect-intro').text()).toContain('Connect your first bank')
    await find('connect-first').trigger('click')
    await flushPromises()
    expect(dialogTitle()).toBe('Connect a bank')
  })

  it('tells viewers an admin connects banks', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
    const { find } = await render({ role: 'viewer' })
    expect(find('read-only-notice').text()).toContain('Only an admin can connect')
    expect(find('connect-intro').text()).toContain('An admin hasn’t connected any banks yet.')
    expect(find('connect-first').exists()).toBe(false)
  })

  it('explains setting Plaid up until it has keys', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
    const { find } = await render({ configured: false })
    expect(find('plaid-setup').text()).toContain('Set up Plaid to connect banks')
    expect(find('plaid-setup-env').text()).toContain('CASHCOVE_PLAID_CLIENT_ID=')
    expect(find('plaid-setup').find('a').attributes('href')).toBe(
      'https://dashboard.plaid.com/developers/keys',
    )
    expect(find('connect-intro').exists()).toBe(false)
  })

  it('tells viewers an admin sets Plaid up', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
    const { find } = await render({ role: 'viewer', configured: false })
    expect(find('plaid-setup').text()).toContain('An admin needs to set up Plaid')
    expect(find('plaid-setup-env').exists()).toBe(false)
    expect(find('connect-add').exists()).toBe(false)
    expect(find('connect-summary').exists()).toBe(true)
  })

  it('checks whether Plaid is set up when nothing has yet', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
    const health = vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue(healthyReport)
    const system = vi
      .spyOn(systemApi, 'fetchSystemInfo')
      .mockResolvedValue(makeSystemInfo({ configured: true }))
    const { find } = await render({ configured: null })
    expect(health).toHaveBeenCalled()
    expect(system).toHaveBeenCalled()
    expect(find('connect-first').exists()).toBe(true)
  })

  it('opens the dialogs each bank asks for', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
    vi.spyOn(api, 'fetchSyncs').mockResolvedValue([])
    const { wrapper, find } = await render()
    const card = () => wrapper.findComponent({ name: 'ConnectionCard' })

    card().vm.$emit('choose', tartan)
    await flushPromises()
    expect(dialogTitle()).toBe('Choose accounts from Tartan Bank')
    await page().find('.v-overlay--active [data-test="connect-later"]').trigger('click')
    await flushPromises()

    card().vm.$emit('history', tartan)
    await flushPromises()
    expect(dialogTitle()).toBe('Tartan Bank sync history')
    await page().find('.v-overlay--active [data-test="dialog-close"]').trigger('click')
    await flushPromises()

    card().vm.$emit('remove', tartan)
    await flushPromises()
    expect(dialogTitle()).toBe('Remove Tartan Bank?')
    await page().find('.v-overlay--active [data-test="dialog-close"]').trigger('click')
    await flushPromises()

    await find('connect-add').trigger('click')
    await flushPromises()
    expect(dialogTitle()).toBe('Connect a bank')
  })

  it('checks back while a bank syncs, until the tab closes', async () => {
    const fetch = vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
    const { wrapper } = await render()
    expect(fetch).toHaveBeenCalledOnce()

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fetch.mockResolvedValue([makeConnection({ syncing: true })])
    useConnectionsStore().put(makeConnection({ syncing: true }))
    await flushPromises()
    vi.advanceTimersByTime(SYNCING_POLL)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    vi.advanceTimersByTime(SYNCING_POLL)
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  describe('after a bank’s own sign-in page', () => {
    const oauth = '/connect/oauth?oauth_state_id=abc'

    it('picks up connecting a new bank', async () => {
      vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
      link.rememberLink({
        token: 'link-kept',
        purpose: 'connect',
        connectionId: null,
        historyDays: 90,
      })
      vi.spyOn(link, 'loadLink').mockResolvedValue({ create: vi.fn() })
      const open = vi.spyOn(link, 'openLink').mockResolvedValue({ connected: false, error: null })
      const { router } = await render({ route: oauth })

      await vi.waitFor(() => {
        expect(router.currentRoute.value.fullPath).toBe('/connect')
      })
      expect(open).toHaveBeenCalledWith('link-kept', window.location.href)
      expect(dialogTitle()).toBe('Connect a bank')
    })

    it('says when the sign-in can’t be picked up', async () => {
      vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
      await render({ route: oauth })
      expect(notices.value.at(-1)).toMatchObject({
        text: 'That bank sign-in has expired. Start connecting the bank again.',
        tone: 'error',
      })
    })

    it('finishes reconnecting a bank', async () => {
      vi.spyOn(api, 'fetchConnections').mockResolvedValue([fidelity])
      link.rememberLink({
        token: 'link-kept',
        purpose: 'reconnect',
        connectionId: fidelity.id,
        historyDays: null,
      })
      const relink = vi.spyOn(actions, 'relink').mockResolvedValue(fidelity)
      await render({ route: oauth })
      expect(relink).toHaveBeenCalledWith(fidelity, 'reconnect', {
        token: 'link-kept',
        redirectUri: window.location.href,
      })
      expect(page().find('.v-overlay--active .app-dialog').exists()).toBe(false)
    })

    it('offers the accounts a bank now shares', async () => {
      const updated = makeConnection({ accounts: [sharedCard, sharedSavings] })
      vi.spyOn(api, 'fetchConnections').mockResolvedValue([tartan])
      link.rememberLink({
        token: 'link-kept',
        purpose: 'accounts',
        connectionId: tartan.id,
        historyDays: null,
      })
      vi.spyOn(actions, 'relink').mockResolvedValue(updated)
      await render({ route: oauth })
      expect(dialogTitle()).toBe('Choose accounts from Tartan Bank')
    })

    it('does nothing for a bank that has since been removed', async () => {
      vi.spyOn(api, 'fetchConnections').mockResolvedValue([])
      link.rememberLink({
        token: 'link-kept',
        purpose: 'accounts',
        connectionId: 'connection-gone',
        historyDays: null,
      })
      const relink = vi.spyOn(actions, 'relink')
      await render({ route: oauth })
      expect(relink).not.toHaveBeenCalled()
      expect(notices.value).toEqual([])
    })
  })
})

describe('ConnectSummary', () => {
  it('says when everything is healthy, and when syncing is off', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([
      makeConnection({ next_sync_at: null, last_synced_at: null }),
    ])
    const { find } = await render()
    expect(find('connect-summary-health').text()).toBe('All healthy')
    expect(find('connect-summary-last').text()).toBe('Not yet')
    expect(find('connect-summary-next').text()).toBe('Not scheduled')
    expect(find('connect-summary').find('a').text()).toBe('Change the schedule')

    const preferences = usePreferencesStore()
    preferences.saved = {
      ...makePreferences(),
      sync: { ...makePreferences().sync, auto_sync: false },
    }
    await flushPromises()
    expect(find('connect-summary-next').text()).toBe('Off')
    expect(find('connect-summary').find('a').text()).toBe('Turn on automatic sync')
    expect(find('connect-summary').find('a').attributes('href')).toBe('/settings/sync')
  })

  it('counts every bank that needs attention', async () => {
    vi.spyOn(api, 'fetchConnections').mockResolvedValue([
      fidelity,
      makeConnection({ id: 'c2', status: 'error' }),
    ])
    const { find } = await render()
    expect(find('connect-summary-health').text()).toBe('2 need attention')
  })
})
