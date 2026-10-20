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

  it('keeps the tab lit while one of the pages inside it is open', async () => {
    const id = '0b3f6a52-8a9f-4c5e-9d3f-6f7a4c1d2e90'
    const lit = async (route: string) => {
      const { wrapper } = await mountWithPlugins(AppNavigation, {
        withApp: true,
        width: 1920,
        route,
      })
      const active = wrapper.findAll('.v-list-item--active').map((item) => item.text())
      wrapper.unmount()
      return active
    }

    expect(await lit(`/bills/${id}`)).toEqual(['Bills'])
    expect(await lit(`/subscriptions/${id}`)).toEqual(['Subscriptions'])
    // Nothing else is lit by it, and the list's own page still lights its own tab.
    expect(await lit('/bills')).toEqual(['Bills'])
    expect(await lit('/transactions')).toEqual(['Transactions'])
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
    // The number is for the eyes and the sentence is for the ears, so neither is heard twice.
    expect(alerts().find('[aria-hidden="true"]').text()).toBe('1')
    expect(alerts().find('.d-sr-only').text()).toBe('1 bank needs attention')
    // The tab is named by its own text, which holds the title and what needs attention.
    const connect = () => wrapper.find('.app-nav__item[href="/connect"]')
    expect(connect().attributes('aria-label')).toBeUndefined()

    useConnectionsStore().connections = [fidelity, makeConnection({ id: 'c2', status: 'error' })]
    await wrapper.vm.$nextTick()
    expect(alerts().find('[aria-hidden="true"]').text()).toBe('2')
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
    expect(wrapper.find('.app-nav__brand').text()).toContain('Personal finance')
    expect(wrapper.find('[data-test="status-indicator"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps the desktop rail compact while naming every icon link', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 1920,
      props: { collapsed: true },
    })
    const toggle = wrapper.find('[data-test="nav-collapse-toggle"]')
    expect(wrapper.find('.app-nav').classes()).toContain('app-nav--rail')
    expect(wrapper.find('.app-nav__brand-copy').exists()).toBe(false)
    expect(wrapper.findAll('.app-nav__item').map((link) => link.attributes('aria-label'))).toEqual(
      navItems.map((item) => item.title),
    )
    expect(toggle.attributes('aria-label')).toBe('Expand navigation')

    await toggle.trigger('click')
    expect(wrapper.findComponent(AppNavigation).emitted('collapse')).toHaveLength(1)
    wrapper.unmount()
  })

  it('names the tabs by their own text unless the rail hides it', async () => {
    const rail = async (props: { collapsed?: boolean; mobile?: boolean }) => {
      const { wrapper } = await mountWithPlugins(AppNavigation, {
        withApp: true,
        width: 1920,
        props,
        beforeMount: () => {
          useConnectionsStore().connections = [tartan, fidelity]
        },
      })
      const labels = wrapper.findAll('.app-nav__item').map((link) => link.attributes('aria-label'))
      wrapper.unmount()
      return labels
    }

    // Written out, a tab's text is its name, and an aria-label would replace the number beside it.
    expect((await rail({})).every((label) => label === undefined)).toBe(true)
    expect(
      (await rail({ mobile: true, collapsed: true })).every((label) => label === undefined),
    ).toBe(true)
    // In the rail the titles are out of sight, so each tab says its title, and Connect what needs attention.
    expect(await rail({ collapsed: true })).toEqual(
      navItems.map((item) =>
        item.name === 'connect' ? 'Connect, 1 bank needs attention' : item.title,
      ),
    )
  })

  it('lets a mobile drawer close without showing the desktop rail control', async () => {
    const { wrapper } = await mountWithPlugins(AppNavigation, {
      withApp: true,
      width: 390,
      props: { mobile: true, modelValue: true },
    })
    expect(wrapper.find('[data-test="mobile-nav-close"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="nav-collapse-toggle"]').exists()).toBe(false)

    await wrapper.find('[data-test="mobile-nav-close"]').trigger('click')
    expect(wrapper.findComponent(AppNavigation).emitted('update:modelValue')?.[0]).toEqual([false])
    wrapper.unmount()
  })
})
