import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/accounts'
import { ApiError } from '@/api/client'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { answer, menuSettled } from '@/test/confirm'
import { page } from '@/test/dom'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AccountRow from '@/views/accounts/AccountRow.vue'

async function render(account: api.Account, role: 'admin' | 'viewer' = 'admin') {
  const mounted = await mountWithPlugins(AccountRow, {
    width: 1280,
    props: { account },
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="account-${name}"]`)
  async function choose(action: string) {
    await menuSettled()
    await find('actions').trigger('click')
    await flushPromises()
    await page().find(`.v-overlay--active [data-test="account-${action}"]`).trigger('click')
    await flushPromises()
  }
  return { ...mounted, find, choose }
}

describe('AccountRow', () => {
  it('shows what an account is and what is in it', async () => {
    const { find } = await render(checking)
    expect(find('name').text()).toBe('Everyday checking')
    expect(find('details').text()).toBe('Harbor Credit Union · •••• 4410 · Checking')
    expect(find('balance').text()).toBe('$2,450.18')
    expect(find('link').text()).toContain('Updated')
    expect(find('link').attributes('href')).toBe('/transactions?account=account-checking')
    expect(find('linked').exists()).toBe(false)
    expect(find('utilization').exists()).toBe(false)
  })

  it('shows what is owed on a linked card and how much of its limit is used', async () => {
    const { find } = await render(visa)
    expect(find('details').text()).toBe('Tartan Bank · •••• 3333 · Credit card')
    expect(find('linked').text()).toBe('Linked')
    expect(find('balance').text()).toBe('$612.40')
    expect(find('link').text()).toContain('owed')
    expect(find('utilization').text()).toBe('12% of $5,000.00')
    expect(find('utilization').html()).toContain('bg-success')
  })

  it.each([
    ['-1600.00', 'bg-warning', '32% of $5,000.00'],
    ['-6000.00', 'bg-error', '100% of $5,000.00'],
  ])('colors a card owing %s by how much of its limit is used', async (balance, color, text) => {
    const { find } = await render({ ...visa, balance })
    expect(find('utilization').text()).toBe(text)
    expect(find('utilization').html()).toContain(color)
  })

  it('says when a card is in credit, and leaves out what is not known', async () => {
    const { find } = await render(
      makeAccount({ type: 'credit_card', balance: '25.00', institution: null, mask: null }),
    )
    expect(find('balance').text()).toBe('$25.00')
    expect(find('link').text()).toContain('in credit')
    expect(find('details').text()).toBe('Credit card')
    expect(find('utilization').exists()).toBe(false)
  })

  it('shows what is available when the bank says', async () => {
    const { find } = await render({ ...checking, available_balance: '2400.00', currency: 'EUR' })
    expect(find('balance').text()).toBe('€2,450.18')
    expect(find('link').text()).toContain('€2,400.00 available')
  })

  it('asks the dialog to edit it', async () => {
    const { wrapper, choose } = await render(checking)
    await choose('edit')
    expect(wrapper.emitted('edit')).toEqual([[checking]])
  })

  it('closes an account after checking', async () => {
    const closed = { ...checking, closed_at: '2026-09-20T12:00:00Z' }
    const update = vi.spyOn(api, 'updateAccount').mockResolvedValue(closed)
    const { choose } = await render(checking)

    await choose('close')
    expect(confirmRequest.value?.title).toBe('Close Everyday checking?')
    await answer(true)

    expect(update).toHaveBeenCalledWith(checking.id, { closed: true })
    expect(useAccountsStore().find(checking.id)?.closed_at).toBe(closed.closed_at)
    expect(notices.value.at(-1)?.text).toBe('Closed Everyday checking')
  })

  it('keeps the account open when closing is cancelled', async () => {
    const update = vi.spyOn(api, 'updateAccount')
    const { choose } = await render(checking)
    await choose('close')
    await answer(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('reopens a closed account straight away', async () => {
    const closed = { ...savings, closed_at: '2026-09-20T12:00:00Z' }
    vi.spyOn(api, 'updateAccount').mockResolvedValue(savings)
    const { choose } = await render(closed)

    await choose('reopen')

    expect(useAccountsStore().find(savings.id)?.closed_at).toBeNull()
    expect(notices.value.at(-1)?.text).toBe('Reopened Rainy day fund')
  })

  it('says why reopening failed, unless the admin cancelled', async () => {
    const closed = { ...savings, closed_at: '2026-09-20T12:00:00Z' }
    const update = vi
      .spyOn(api, 'updateAccount')
      .mockRejectedValueOnce(new ApiError(500, 'Cashcove ran into a problem.'))
      .mockRejectedValueOnce(
        new ApiError(403, 'Confirm it is you.', { code: 'verification_required' }),
      )
    const { choose } = await render(closed)

    await choose('reopen')
    expect(notices.value.at(-1)).toMatchObject({
      text: 'Cashcove ran into a problem.',
      tone: 'error',
    })
    await choose('reopen')
    expect(update).toHaveBeenCalledTimes(2)
    expect(notices.value).toHaveLength(1)
  })

  it.each([
    [
      checking,
      'This deletes it and its 12 transactions for good. To keep its history, close it instead.',
    ],
    [
      { ...checking, transaction_count: 1 },
      'This deletes it and its 1 transaction for good. To keep its history, close it instead.',
    ],
    [
      { ...checking, transaction_count: 0 },
      'This deletes it for good. To keep its history, close it instead.',
    ],
  ])('deletes an account after warning about its transactions', async (account, warning) => {
    const remove = vi.spyOn(api, 'deleteAccount').mockResolvedValue(undefined)
    const { choose } = await render(account)

    await choose('delete')
    expect(confirmRequest.value?.text).toBe(warning)
    await answer(true)

    expect(remove).toHaveBeenCalledWith(checking.id)
    expect(useAccountsStore().find(checking.id)).toBeUndefined()
    expect(notices.value.at(-1)?.text).toBe('Deleted Everyday checking')
  })

  it('keeps the account when deleting is cancelled', async () => {
    const remove = vi.spyOn(api, 'deleteAccount')
    const { choose } = await render(checking)
    await choose('delete')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()
    expect(useAccountsStore().find(checking.id)).toBeDefined()
  })

  it('links viewers to transactions without any actions', async () => {
    const { find } = await render(checking, 'viewer')
    expect(find('link').exists()).toBe(true)
    expect(find('actions').exists()).toBe(false)
  })

  it('lists the transactions from its menu too', async () => {
    const { find } = await render(checking)
    await menuSettled()
    await find('actions').trigger('click')
    await flushPromises()
    expect(
      page().find('.v-overlay--active [data-test="account-transactions"]').attributes('href'),
    ).toBe('/transactions?account=account-checking')
  })
})
