import MoneyAmount from '@/components/ui/MoneyAmount.vue'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(props: Record<string, unknown>) {
  const { wrapper } = await mountWithPlugins(MoneyAmount, { props, beforeMount: () => seedFinance() })
  return wrapper
}

describe('MoneyAmount', () => {
  it('shows an amount in the household currency', async () => {
    const wrapper = await render({ amount: '-1234.5' })
    expect(wrapper.text()).toBe('-$1,234.50')
    expect(wrapper.classes()).toContain('tabular-nums')
    expect(wrapper.classes()).not.toContain('money--in')
  })

  it('signs money coming in and colors it', async () => {
    const incoming = await render({ amount: '2400', signed: true })
    expect(incoming.text()).toBe('+$2,400.00')
    expect(incoming.classes()).toContain('money--in')

    const outgoing = await render({ amount: '-4.5', signed: true, currency: 'EUR' })
    expect(outgoing.text()).toBe('-€4.50')
    expect(outgoing.classes()).not.toContain('money--in')
  })
})
