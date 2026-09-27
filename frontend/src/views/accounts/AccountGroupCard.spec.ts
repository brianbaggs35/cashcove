import type { Account } from '@/api/accounts'
import { accountGroups, type AccountGroupKey } from '@/components/finance/accountTypes'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AccountGroupCard from '@/views/accounts/AccountGroupCard.vue'

async function render(key: AccountGroupKey, accounts: Account[]) {
  const group = accountGroups.find((item) => item.key === key)!
  const { wrapper } = await mountWithPlugins(AccountGroupCard, {
    props: { group, accounts },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('AccountGroupCard', () => {
  it('lists the accounts with what they add up to', async () => {
    const euros = makeAccount({ id: 'euros', currency: 'EUR', balance: '10.00' })
    const wrapper = await render('cash', [checking, savings, euros])
    expect(wrapper.find('h2').text()).toBe('Cash')
    expect(wrapper.find('.v-chip').text()).toBe('3')
    expect(wrapper.find('[data-test="account-group-total"]').text()).toBe('$14,950.18 · €10.00')
    expect(wrapper.findAll('[data-test="account-row"]')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('owed')
  })

  it('adds up what is owed on cards and loans', async () => {
    const wrapper = await render('credit', [visa])
    expect(wrapper.find('[data-test="account-group-total"]').text()).toBe('$612.40')
    expect(wrapper.text()).toContain('owed')
  })

  it('passes on which account to edit', async () => {
    const wrapper = await render('credit', [visa])
    wrapper.findComponent({ name: 'AccountRow' }).vm.$emit('edit', visa)
    expect(wrapper.emitted('edit')).toEqual([[visa]])
  })
})
