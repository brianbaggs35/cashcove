import { useTheme } from 'vuetify'

import App from '@/App.vue'
import { useThemeStore } from '@/stores/theme'
import { flushPromises, mountWithPlugins } from '@/test/mount'

describe('App', () => {
  it('shows the current tab in the app bar', async () => {
    const { wrapper } = await mountWithPlugins(App, { route: '/transactions', width: 1920 })
    expect(wrapper.find('.v-app-bar-title').text()).toBe('Transactions')
    expect(wrapper.find('h1').text()).toBe('Transactions')
    expect(wrapper.find('[data-test="nav-toggle"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('falls back to the app name before the first navigation', async () => {
    const { wrapper } = await mountWithPlugins(App, { width: 1920 })
    expect(wrapper.find('.v-app-bar-title').text()).toBe('Cashcove')
    wrapper.unmount()
  })

  it('opens the navigation drawer from the menu button on mobile', async () => {
    const { wrapper } = await mountWithPlugins(App, { route: '/accounts', width: 390 })
    const drawer = () => wrapper.find('.v-navigation-drawer')
    expect(drawer().classes()).not.toContain('v-navigation-drawer--active')
    await wrapper.find('[data-test="nav-toggle"]').trigger('click')
    expect(drawer().classes()).toContain('v-navigation-drawer--active')
    wrapper.unmount()
  })

  it('applies the saved theme preference to Vuetify', async () => {
    const { wrapper, vuetify } = await mountWithPlugins(App, { route: '/accounts', width: 1920 })
    useThemeStore().setPreference('dark')
    await flushPromises()
    expect(vuetify.theme.name.value).toBe('dark')
    useThemeStore().setPreference('light')
    await flushPromises()
    expect(vuetify.theme.name.value).toBe('light')
    expect(useTheme).toBeTypeOf('function')
    wrapper.unmount()
  })
})
