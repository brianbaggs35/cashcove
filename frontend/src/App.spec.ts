import * as healthApi from '@/api/health'
import App from '@/App.vue'
import { useThemeStore } from '@/stores/theme'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import { greeting } from '@/utils/format'

describe('App', () => {
  it('greets you on desktop and renders the current tab', async () => {
    const { wrapper } = await mountWithPlugins(App, { route: '/transactions', width: 1920 })
    expect(wrapper.find('[data-test="app-greeting"]').text()).toContain(greeting(new Date()))
    expect(wrapper.find('h1').text()).toBe('Transactions')
    expect(wrapper.find('[data-test="app-brand"]').exists()).toBe(false)
    expect(wrapper.find('.v-bottom-navigation').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows the brand and bottom navigation on mobile, with More opening the drawer', async () => {
    const { wrapper } = await mountWithPlugins(App, { route: '/accounts', width: 390 })
    expect(wrapper.find('[data-test="app-brand"]').text()).toContain('Cashcove')
    expect(wrapper.find('[data-test="app-greeting"]').exists()).toBe(false)
    const drawer = () => wrapper.find('.v-navigation-drawer')
    expect(drawer().classes()).not.toContain('v-navigation-drawer--active')
    await wrapper.find('[data-test="bottom-more"]').trigger('click')
    expect(drawer().classes()).toContain('v-navigation-drawer--active')
    wrapper.unmount()
  })

  it('checks system health on startup', async () => {
    const fetchHealth = vi.spyOn(healthApi, 'fetchHealth')
    const { wrapper } = await mountWithPlugins(App, { route: '/accounts', width: 1920 })
    expect(fetchHealth).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('applies the theme preference to Vuetify', async () => {
    const { wrapper, vuetify } = await mountWithPlugins(App, { route: '/accounts', width: 1920 })
    useThemeStore().setPreference('dark')
    await flushPromises()
    expect(vuetify.theme.name.value).toBe('dark')
    useThemeStore().setPreference('light')
    await flushPromises()
    expect(vuetify.theme.name.value).toBe('light')
    wrapper.unmount()
  })
})
