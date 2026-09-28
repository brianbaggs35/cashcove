import { flushPromises } from '@vue/test-utils'

import type { Connection } from '@/api/connections'
import {
  fidelity,
  makeConnection,
  makeShared,
  makeSync,
  sharedSavings,
  tartan,
} from '@/test/connections'
import { menuSettled } from '@/test/confirm'
import { click, page } from '@/test/dom'
import { seedFinance, visa } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import * as actions from '@/views/connect/actions'
import ConnectionCard from '@/views/connect/ConnectionCard.vue'

async function render(
  connection: Connection = tartan,
  { role = 'admin', width = 1280 }: { role?: 'admin' | 'viewer'; width?: number } = {},
) {
  const mounted = await mountWithPlugins(ConnectionCard, {
    width,
    props: { connection },
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance({ accounts: [{ ...visa, name: 'Travel card' }] }),
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

async function openMenu(find: (name: string) => { trigger: (event: string) => Promise<void> }) {
  await find('connection-actions').trigger('click')
  await flushPromises()
}

const menuItem = (name: string) => page().find(`.v-overlay--active [data-test="${name}"]`)

describe('ConnectionCard', () => {
  it('shows a healthy bank, when it syncs, and its accounts', async () => {
    const { find, wrapper } = await render()

    expect(find('connection-name').text()).toBe('Tartan Bank')
    expect(find('connection-status').text()).toBe('Up to date')
    expect(find('connection-meta').text()).toMatch(/^Connected Jun 9, 2026.*Synced .*Next sync /)
    expect(find('connection-problem').exists()).toBe(false)
    expect(find('bank-logo').find('img').exists()).toBe(false)

    const rows = wrapper.findAll('[data-test="connection-account"]')
    expect(rows.map((row) => row.element.tagName)).toEqual(['A', 'DIV'])
    expect(rows[0]!.attributes('href')).toBe('/transactions?account=account-visa')
    expect(rows[0]!.text()).toContain('Travel card')
    expect(rows[0]!.text()).toContain('Imported')
    expect(rows[0]!.text()).toContain('owed')
    expect(rows[1]!.text()).toContain('Tartan Checking')
    expect(rows[1]!.text()).toContain('Not imported')
    expect(rows[1]!.classes()).toContain('connection__account--muted')

    expect(find('connection-last-sync').text()).toMatch(/: 1 new transaction and 1 updated$/)
    await find('connection-history-link').trigger('click')
    expect(wrapper.emitted('history')).toEqual([[tartan]])
  })

  it('syncs now, showing progress meanwhile', async () => {
    let done: () => void = () => undefined
    const sync = vi.spyOn(actions, 'syncNow').mockReturnValue(
      new Promise((resolve) => {
        done = resolve
      }),
    )
    const { find } = await render()

    await find('connection-sync').trigger('click')
    expect(sync).toHaveBeenCalledWith(tartan)
    expect(find('connection-status').text()).toBe('Syncing')
    await openMenu(find)
    expect(menuItem('connection-choose').classes()).toContain('v-list-item--disabled')
    done()
    await flushPromises()
    expect(find('connection-status').text()).toBe('Up to date')
  })

  it('shows a sync the schedule started as it runs', async () => {
    const { find } = await render(makeConnection({ syncing: true }))
    expect(find('connection-status').text()).toBe('Syncing')
    expect(find('connection-sync').attributes('disabled')).toBeUndefined()
  })

  it('asks for a sign-in when the bank wants one', async () => {
    const reconnect = vi.spyOn(actions, 'relink').mockResolvedValue(null)
    const { find } = await render(fidelity)

    expect(find('connection-status').text()).toBe('Sign-in needed')
    expect(find('connection-sync').exists()).toBe(false)
    expect(find('connection-meta').text()).toContain('Paused until you reconnect')
    expect(find('connection-problem').text()).toContain(fidelity.error_message)
    expect(find('bank-logo').find('img').attributes('src')).toBe(
      'data:image/png;base64,iVBORw0KGgo=',
    )
    expect(find('connection-last-sync').text()).toMatch(/: failed$/)

    await find('connection-problem-reconnect').trigger('click')
    await flushPromises()
    expect(reconnect).toHaveBeenCalledWith(fidelity, 'reconnect')
  })

  it('offers to try a failed sync again', async () => {
    const sync = vi.spyOn(actions, 'syncNow').mockResolvedValue()
    const { find } = await render(makeConnection({ status: 'error' }))
    expect(find('connection-status').text()).toBe('Sync failed')
    expect(find('connection-problem').text()).toContain('The last sync of Tartan Bank failed.')
    await find('connection-problem-retry').trigger('click')
    expect(sync).toHaveBeenCalled()
  })

  it('falls back to its own words when Plaid gave none', async () => {
    const { find } = await render(makeConnection({ status: 'login_required', error_message: null }))
    expect(find('connection-problem').text()).toContain('Tartan Bank needs you to sign in again.')
  })

  it('says when history is still coming in', async () => {
    const pending = await render(makeConnection({ history: 'pending' }))
    expect(pending.find('connection-status').text()).toBe('Importing history')
    expect(pending.find('connection-importing').text()).toContain('Plaid is fetching transactions')
    pending.wrapper.unmount()

    const recent = await render(makeConnection({ history: 'recent' }))
    expect(recent.find('connection-importing').text()).toContain('The last month or so is in.')
  })

  it('warns before the bank stops sharing', async () => {
    const reconnect = vi.spyOn(actions, 'relink').mockResolvedValue(null)
    const soon = new Date(Date.now() + 10 * 86_400_000)
    const { find, wrapper } = await render(
      makeConnection({ consent_expires_at: soon.toISOString() }),
    )
    expect(find('connection-consent').text()).toContain('Tartan Bank stops sharing on')
    await find('connection-consent').find('button').trigger('click')
    expect(reconnect).toHaveBeenCalled()
    wrapper.unmount()

    const later = await render(
      makeConnection({ consent_expires_at: new Date(Date.now() + 90 * 86_400_000).toISOString() }),
    )
    expect(later.find('connection-consent').exists()).toBe(false)
  })

  it('points out accounts that haven’t been chosen yet', async () => {
    const one = await render(makeConnection({ accounts: [makeShared(), sharedSavings] }))
    expect(one.find('connection-unchosen').text()).toContain(
      'Tartan Bank shares an account you haven’t chosen whether to import yet.',
    )
    await one.find('connection-unchosen-choose').trigger('click')
    expect(one.wrapper.emitted('choose')).toHaveLength(1)
    one.wrapper.unmount()

    const two = await render(
      makeConnection({
        accounts: [makeShared(), sharedSavings, { ...sharedSavings, id: 'plaid-other' }],
      }),
    )
    expect(two.find('connection-unchosen').text()).toContain('shares 2 accounts')
    two.wrapper.unmount()

    const none = await render(makeConnection({ accounts: [sharedSavings], last_sync: null }))
    expect(none.find('connection-unchosen').text()).toContain(
      'Nothing is imported from Tartan Bank until its accounts are chosen.',
    )
    expect(none.find('connection-last-sync').exists()).toBe(false)
  })

  it('offers what admins can do with the bank', async () => {
    const reconnect = vi.spyOn(actions, 'relink').mockResolvedValue(null)
    const { find, wrapper } = await render(
      makeConnection({ last_sync: makeSync({ added: 0, updated: 0 }) }),
    )
    expect(find('connection-last-sync').text()).toMatch(/: nothing new$/)

    await openMenu(find)
    await click('.v-overlay--active [data-test="connection-choose"]')
    expect(wrapper.emitted('choose')).toHaveLength(1)
    await menuSettled()

    await openMenu(find)
    await click('.v-overlay--active [data-test="connection-reconnect"]')
    await flushPromises()
    expect(reconnect).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: tartan.id }),
      'reconnect',
    )
    await menuSettled()

    await openMenu(find)
    expect(menuItem('connection-website').attributes('href')).toBe('https://tartanbank.example.com')
    expect(menuItem('connection-website').attributes('target')).toBe('_blank')
    await click('.v-overlay--active [data-test="connection-history"]')
    expect(wrapper.emitted('history')).toHaveLength(1)
    await menuSettled()

    await openMenu(find)
    await click('.v-overlay--active [data-test="connection-remove"]')
    expect(wrapper.emitted('remove')).toHaveLength(1)
  })

  it('lets the bank share other accounts, then offers to import new ones', async () => {
    const updated = makeConnection({ accounts: [makeShared(), sharedSavings] })
    const share = vi.spyOn(actions, 'relink').mockResolvedValue(updated)
    const { find, wrapper } = await render()

    await openMenu(find)
    await click('.v-overlay--active [data-test="connection-share"]')
    await flushPromises()
    expect(share).toHaveBeenCalledWith(tartan, 'accounts')
    expect(wrapper.emitted('choose')).toEqual([[updated]])
    await menuSettled()

    share.mockResolvedValue(null)
    await openMenu(find)
    await click('.v-overlay--active [data-test="connection-share"]')
    await flushPromises()
    expect(wrapper.emitted('choose')).toHaveLength(1)
  })

  it('shows viewers the bank without anything to change', async () => {
    const { find } = await render(fidelity, { role: 'viewer' })
    expect(find('connection-sync').exists()).toBe(false)
    expect(find('connection-problem-reconnect').exists()).toBe(false)
    await openMenu(find)
    expect(menuItem('connection-choose').exists()).toBe(false)
    expect(menuItem('connection-remove').exists()).toBe(false)
    expect(menuItem('connection-website').exists()).toBe(false)
    expect(menuItem('connection-history').exists()).toBe(true)
  })

  it('keeps viewers’ alerts free of buttons too', async () => {
    const { find } = await render(
      makeConnection({
        status: 'error',
        accounts: [sharedSavings],
        consent_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      }),
      { role: 'viewer' },
    )
    expect(find('connection-problem').find('button').exists()).toBe(false)
    expect(find('connection-consent').find('button').exists()).toBe(false)
    expect(find('connection-unchosen').find('button').exists()).toBe(false)
  })

  it('fits the sync button to a phone', async () => {
    const { find } = await render(tartan, { width: 400 })
    expect(find('connection-sync').attributes('aria-label')).toBe('Sync Tartan Bank now')
    expect(find('connection-sync').text()).toBe('')
  })
})
