import MobileBottomNav from '@/components/MobileBottomNav.vue'
import { mountWithPlugins } from '@/test/mount'

describe('MobileBottomNav', () => {
  it('links to the four everyday tabs and offers More', async () => {
    const { wrapper } = await mountWithPlugins(MobileBottomNav, { withApp: true, width: 390 })
    for (const name of ['accounts', 'transactions', 'budget', 'subscriptions']) {
      expect(wrapper.find(`[data-test="bottom-${name}"]`).attributes('href')).toBe(`/${name}`)
    }
    await wrapper.find('[data-test="bottom-more"]').trigger('click')
    expect(wrapper.findComponent(MobileBottomNav).emitted('more')).toHaveLength(1)
    wrapper.unmount()
  })
})
