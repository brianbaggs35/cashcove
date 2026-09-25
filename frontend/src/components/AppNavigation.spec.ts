import AppNavigation from '@/components/AppNavigation.vue'
import { navItems } from '@/navigation'
import { mountWithPlugins } from '@/test/mount'

describe('AppNavigation', () => {
  it('links to every tab and highlights the current one', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      route: '/budget',
    })
    const links = wrapper.findAll('.app-nav__item')
    expect(links.map((link) => link.text())).toEqual(navItems.map((item) => item.title))
    expect(links.map((link) => link.attributes('href'))).toEqual(navItems.map((item) => item.path))
    expect(wrapper.find('.v-list-item--active').text()).toBe('Budget')
    wrapper.unmount()
  })

  it('shows the brand and the system status', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, { withApp: true, width: 1920 })
    expect(wrapper.find('.app-nav__brand').text()).toContain('Cashcove')
    expect(wrapper.find('[data-test="status-indicator"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
