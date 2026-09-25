import * as authApi from '@/api/auth'
import * as healthApi from '@/api/health'
import App from '@/App.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { makeSessionState, signedOutState } from '@/test/fixtures'
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

  it('shows a spinner until the first page is ready', async () => {
    const { wrapper } = await mountWithPlugins(App)
    // The first navigation has finished by now; a fresh app starts with the spinner.
    expect(wrapper.find('[data-test="app-loading"]').exists()).toBe(false)
    const pending = mountWithPlugins(App, {
      beforeMount: () =>
        vi.mocked(authApi.fetchSession).mockReturnValue(new Promise(() => undefined)),
    })
    await flushPromises()
    expect(document.querySelector('[data-test="app-loading"]')).not.toBeNull()
    void pending
  })

  it("says when Cashcove can't be reached, and tries again", async () => {
    const { wrapper } = await mountWithPlugins(App, { route: '/accounts', session: 'unreachable' })
    await flushPromises()
    expect(wrapper.find('[data-test="startup-error"]').text()).toContain("Can't reach Cashcove")

    // Still unreachable: the message stays up.
    await wrapper.find('[data-test="startup-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="startup-error"]').exists()).toBe(true)

    vi.mocked(authApi.fetchSession).mockResolvedValue(makeSessionState())
    await wrapper.find('[data-test="startup-retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="startup-error"]').exists()).toBe(false)
    expect(wrapper.find('h1').text()).toBe('Accounts')
  })

  it('shows pages like sign-in without the app around them', async () => {
    const { wrapper } = await mountWithPlugins(App, {
      route: '/sign-in',
      session: signedOutState(),
    })
    await flushPromises()
    expect(wrapper.find('.auth-layout').exists()).toBe(true)
    expect(wrapper.find('.v-app-bar').exists()).toBe(false)
  })

  it('goes to sign-in when the session runs out, coming back afterwards', async () => {
    const { wrapper, router } = await mountWithPlugins(App, { route: '/budget', width: 1920 })
    useAuthStore().forget('expired')
    // Sign-in loads on first use, so the navigation takes a moment.
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('sign-in')
    })
    expect(router.currentRoute.value.query).toEqual({ redirect: '/budget' })
    expect(wrapper.find('.auth-layout').exists()).toBe(true)
  })

  it('treats a session that ended without a reason as expired', async () => {
    const { router } = await mountWithPlugins(App, { route: '/budget', width: 1920 })
    const auth = useAuthStore()
    auth.state = { ...auth.state!, user: null, session: null }
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('sign-in')
    })
    expect(auth.signedOutReason).toBe('expired')
    expect(router.currentRoute.value.query).toEqual({ redirect: '/budget' })
  })

  it('goes to sign-in without a way back after signing out', async () => {
    vi.spyOn(authApi, 'signOut').mockResolvedValue(undefined)
    const { router } = await mountWithPlugins(App, { route: '/budget', width: 1920 })
    await useAuthStore().signOut()
    await vi.waitFor(() => {
      expect(router.currentRoute.value.name).toBe('sign-in')
    })
    expect(router.currentRoute.value.query).toEqual({})
  })

  it('stays on pages anyone can open', async () => {
    const { router } = await mountWithPlugins(App, { route: '/invite', width: 1920 })
    useAuthStore().forget('expired')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('invite')
  })

  it('does nothing when someone signs in', async () => {
    const { router } = await mountWithPlugins(App, { route: '/sign-in', session: signedOutState() })
    useAuthStore().apply(makeSessionState())
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('sign-in')
  })
})
