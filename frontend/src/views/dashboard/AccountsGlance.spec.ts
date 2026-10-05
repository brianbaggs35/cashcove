import { makeAccount, savings, seedFinance, visa, checking } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import AccountsGlance from '@/views/dashboard/AccountsGlance.vue'

async function render(accounts = [checking, savings, visa]) {
  const { wrapper } = await mountWithPlugins(AccountsGlance, {
    props: { accounts },
    beforeMount: () => seedFinance(),
  })
  return wrapper
}

describe('AccountsGlance', () => {
  it('lists the accounts with the most in them or owed on them first', async () => {
    const wrapper = await render()

    const rows = wrapper.findAll('[data-test="glance-account"]').map((row) => row.text())
    expect(rows).toEqual([
      'Rainy day fundHarbor Credit Union$12,500.00',
      'Everyday checkingHarbor Credit Union$2,450.18',
      'Rewards VisaTartan Bank-$612.40',
    ])
    expect(wrapper.find('[data-test="glance-all"]').text()).toBe('View accounts')
    expect(wrapper.find('[data-test="glance-all"]').attributes('href')).toBe('/accounts')
  })

  it('lists only the biggest few, and says how many there are', async () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      makeAccount({
        id: `account-${index}`,
        name: `Account ${index}`,
        institution: null,
        balance: `${index + 1}00.00`,
      }),
    )

    const wrapper = await render(many)

    expect(wrapper.findAll('[data-test="glance-account"]')).toHaveLength(4)
    expect(wrapper.find('[data-test="glance-account"]').text()).toContain('Account 5')
    expect(wrapper.find('[data-test="glance-account"] .text-medium-emphasis').exists()).toBe(false)
    expect(wrapper.find('[data-test="glance-all"]').text()).toBe('View all 6 accounts')
  })
})
