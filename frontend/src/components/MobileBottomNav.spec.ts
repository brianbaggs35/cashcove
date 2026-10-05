import MobileBottomNav from '@/components/MobileBottomNav.vue'
import { useConnectionsStore } from '@/stores/connections'
import { fidelity } from '@/test/connections'
import { mountWithPlugins } from '@/test/mount'

describe('MobileBottomNav', () => {
  it('links to the everyday tabs, the dashboard first, and offers More', async () => {
    const { wrapper } = await mountWithPlugins(MobileBottomNav, { withApp: true, width: 390 })
    // A navigation landmark, which screen readers list alongside the side menu.
    expect(wrapper.find('nav[aria-label="Quick navigation"]').exists()).toBe(true)
    for (const name of ['dashboard', 'accounts', 'transactions', 'budget']) {
      expect(wrapper.find(`[data-test="bottom-${name}"]`).attributes('href')).toBe(`/${name}`)
    }
    await wrapper.find('[data-test="bottom-more"]').trigger('click')
    expect(wrapper.findComponent(MobileBottomNav).emitted('more')).toHaveLength(1)
    expect(wrapper.find('[data-test="bottom-more"] .v-badge__badge').isVisible()).toBe(false)
    wrapper.unmount()
  })

  it('marks More when a bank needs attention', async () => {
    const { wrapper } = await mountWithPlugins(MobileBottomNav, {
      withApp: true,
      width: 390,
      beforeMount: () => {
        useConnectionsStore().connections = [fidelity]
      },
    })
    expect(wrapper.find('[data-test="bottom-more"] .v-badge__badge').isVisible()).toBe(true)
    expect(wrapper.find('[data-test="bottom-more"] .d-sr-only').text()).toBe(
      ', 1 bank needs attention',
    )
    wrapper.unmount()
  })
})
