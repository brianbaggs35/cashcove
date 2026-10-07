import AppNavigation from '@/components/AppNavigation.vue'
import { navItems } from '@/navigation'
import { useConnectionsStore } from '@/stores/connections'
import { usePreferencesStore } from '@/stores/preferences'
import { fidelity, makeConnection, tartan } from '@/test/connections'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
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
    // Each link sits in a list item, so screen readers can count the tabs.
    expect(wrapper.findAll('ul[aria-label="Sections"] > li > a')).toHaveLength(navItems.length)
    wrapper.unmount()
  })

  it('leaves the AI tab out for a viewer, who can’t open it', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    })
    const titles = wrapper.findAll('.app-nav__item').map((link) => link.text())
    expect(titles).toEqual(navItems.filter((item) => !item.admin).map((item) => item.title))
    expect(titles).not.toContain('AI')
    wrapper.unmount()
  })

  it('points out banks that need attention, unless those alerts are off', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      beforeMount: () => {
        useConnectionsStore().connections = [tartan, fidelity]
      },
    })
    const alerts = () => wrapper.find('[data-test="nav-connect-alerts"]')
    expect(alerts().text()).toBe('1 1 bank needs attention')
    expect(alerts().find('.d-sr-only').text()).toBe('1 bank needs attention')

    useConnectionsStore().connections = [fidelity, makeConnection({ id: 'c2', status: 'error' })]
    await wrapper.vm.$nextTick()
    expect(alerts().find('.d-sr-only').text()).toBe('2 banks need attention')

    const preferences = makePreferences()
    preferences.alerts.sync_failure_enabled = false
    usePreferencesStore().saved = preferences
    await wrapper.vm.$nextTick()
    expect(alerts().exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the brand and the system status', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, { withApp: true, width: 1920 })
    expect(wrapper.find('.app-nav__brand').text()).toContain('Cashcove')
    expect(wrapper.find('[data-test="status-indicator"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
