import AppNavigation from '@/components/AppNavigation.vue'
import { navItems } from '@/navigation'
import { mountWithPlugins } from '@/test/mount'

describe('AppNavigation', () => {
  it('links to every tab', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      route: '/budget',
    })
    const links = wrapper.findAll('.v-list-item')
    expect(links.map((link) => link.text())).toEqual(navItems.map((item) => item.title))
    expect(links.map((link) => link.attributes('href'))).toEqual(navItems.map((item) => item.path))
    expect(wrapper.find('.v-list-item--active').text()).toBe('Budget')
    expect(wrapper.text()).not.toContain('Version')
    wrapper.unmount()
  })

  it('shows the version when given', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      props: { version: '1.2.3' },
    })
    expect(wrapper.text()).toContain('Version 1.2.3')
    wrapper.unmount()
  })
})
