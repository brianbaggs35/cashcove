import type { Account } from '@/api/accounts'
import { checking, makeAccount, savings, seedFinance, visa } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import NetWorthCard from '@/views/accounts/NetWorthCard.vue'

async function render(accounts: Account[], slots: Record<string, string> = {}) {
  const { wrapper } = await mountWithPlugins(NetWorthCard, {
    props: { accounts },
    slots,
    beforeMount: () => seedFinance(),
  })
  const text = (name: string) => wrapper.find(`[data-test="net-worth-${name}"]`).text()
  return { wrapper, text }
}

describe('NetWorthCard', () => {
  it('shows what the household has, owes and is worth', async () => {
    const { wrapper, text } = await render([checking, savings, visa])
    expect(text('total')).toBe('$14,337.78')
    expect(text('assets')).toBe('$14,950.18')
    expect(text('owed')).toBe('$612.40')
    expect(wrapper.find('[role="img"]').attributes('aria-label')).toBe('Assets 96%, owed 4%')
    expect(wrapper.find('[data-test="net-worth-other"]').exists()).toBe(false)
  })

  it('lists other currencies without converting them', async () => {
    const euros = makeAccount({ id: 'euros', currency: 'EUR', balance: '100.00' })
    const pounds = makeAccount({ id: 'pounds', currency: 'GBP', balance: '5.00' })
    const { text } = await render([euros, pounds])
    expect(text('total')).toBe('$0.00')
    expect(text('other')).toBe(
      "Accounts in other currencies aren't converted: €100.00 net in EUR, £5.00 net in GBP",
    )
  })

  it('has room under its figures for more', async () => {
    const { wrapper } = await render([checking], { default: '<p data-test="extra">More</p>' })
    expect(wrapper.find('[data-test="net-worth"] [data-test="extra"]').text()).toBe('More')
  })

  it('fills the bar when there is nothing yet', async () => {
    const { wrapper } = await render([])
    expect(wrapper.find('[role="img"]').attributes('aria-label')).toBe('Assets 100%, owed 0%')
  })
})
