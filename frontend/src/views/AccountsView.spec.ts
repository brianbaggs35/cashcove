import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/accounts'
import { ApiError } from '@/api/client'
import { page } from '@/test/dom'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AccountsView from '@/views/AccountsView.vue'

const oldCard = makeAccount({
  id: 'account-old',
  name: 'Old store card',
  type: 'credit_card',
  balance: '0.00',
  closed_at: '2026-01-01T00:00:00Z',
})

async function render(role: 'admin' | 'viewer' = 'admin') {
  const mounted = await mountWithPlugins(AccountsView, {
    width: 1280,
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance({ accounts: [] }).accounts.loaded = false,
  })
  await flushPromises()
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

const dialogTitle = () => page().find('.v-overlay--active .app-dialog h2').text()

describe('AccountsView', () => {
  it('shows net worth and the open accounts by kind, with closed ones tucked away', async () => {
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue([checking, savings, visa, oldCard])
    const { wrapper, find } = await render()

    expect(find('net-worth-total').text()).toBe('$14,337.78')
    expect(wrapper.findAll('h2').map((heading) => heading.text())).toEqual(['Cash', 'Credit cards'])
    expect(find('account-group-cash').findAll('[data-test="account-row"]')).toHaveLength(2)
    expect(find('accounts-closed').text()).toContain('Closed accounts')
    expect(find('read-only-notice').exists()).toBe(false)
  })

  it('adds an account from the header and edits one from its row', async () => {
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue([checking])
    const { wrapper, find } = await render()

    await find('account-add').trigger('click')
    await flushPromises()
    expect(dialogTitle()).toBe('Add an account')
    await page().find('.v-overlay--active [data-test="dialog-close"]').trigger('click')
    await flushPromises()

    wrapper.findComponent({ name: 'AccountGroupCard' }).vm.$emit('edit', checking)
    await flushPromises()
    expect(dialogTitle()).toBe('Edit Everyday checking')
  })

  it('edits closed accounts too', async () => {
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue([checking, oldCard])
    const { wrapper, find } = await render()
    await find('accounts-closed').find('button').trigger('click')
    await flushPromises()
    const rows = wrapper.findAllComponents({ name: 'AccountRow' })
    rows.at(-1)!.vm.$emit('edit', oldCard)
    await flushPromises()
    expect(dialogTitle()).toBe('Edit Old store card')
  })

  it('invites admins to add their first account', async () => {
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue([])
    const { find } = await render()

    expect(find('empty-state').text()).toContain('No accounts yet')
    expect(find('account-add').exists()).toBe(false)
    expect(find('empty-state').find('a').attributes('href')).toBe('/connect')
    await find('account-add-first').trigger('click')
    await flushPromises()
    expect(dialogTitle()).toBe('Add an account')
  })

  it('shows viewers everything without ways to change it', async () => {
    vi.spyOn(api, 'fetchAccounts').mockResolvedValue([])
    const { find } = await render('viewer')

    expect(find('read-only-notice').text()).toContain('Only an admin can add or change them')
    expect(find('empty-state').text()).toContain("An admin hasn't added any accounts yet.")
    expect(find('account-add-first').exists()).toBe(false)
    expect(page().find('.app-dialog').exists()).toBe(false)
  })

  it('says when the accounts could not load, and tries again', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAccounts')
      .mockRejectedValueOnce(new ApiError(0, "Can't reach Cashcove."))
      .mockResolvedValue([checking])
    const { find } = await render()

    expect(find('accounts-error').text()).toContain("Couldn't load your accounts. Can't reach Cashcove.")
    await find('accounts-retry').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('net-worth').exists()).toBe(true)
  })

  it('shows placeholders while the accounts load', async () => {
    vi.spyOn(api, 'fetchAccounts').mockReturnValue(new Promise(() => undefined))
    const { find } = await render()
    expect(find('accounts-loading').exists()).toBe(true)
  })
})
