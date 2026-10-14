import { Wallet } from '@lucide/vue'

import StatTile from '@/components/ui/StatTile.vue'
import { mountWithPlugins } from '@/test/mount'

describe('StatTile', () => {
  it('shows what it is, its value and a line of detail', async () => {
    const { wrapper } = await mountWithPlugins(StatTile, {
      props: { icon: Wallet, label: 'Paid so far' },
      slots: { default: '$48.97', detail: '3 payments' },
    })

    expect(wrapper.text()).toContain('Paid so far')
    expect(wrapper.find('[data-test="stat-value"]').text()).toBe('$48.97')
    expect(wrapper.find('[data-test="stat-detail"]').text()).toBe('3 payments')
    // The icon is decoration: the label says it all.
    expect(wrapper.find('.v-icon').attributes('aria-hidden')).toBe('true')
  })

  it('leaves the detail line out when there is none', async () => {
    const { wrapper } = await mountWithPlugins(StatTile, {
      props: { icon: Wallet, label: 'Paid so far' },
      slots: { default: '$48.97' },
    })

    expect(wrapper.find('[data-test="stat-detail"]').exists()).toBe(false)
  })
})
