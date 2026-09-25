import * as api from '@/api/preferences'
import { notices } from '@/composables/notify'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import SettingsView from '@/views/SettingsView.vue'

describe('SettingsView', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchPreferences').mockResolvedValue(makePreferences())
  })

  async function render(route = '/settings') {
    const mounted = await mountWithPlugins(SettingsView, { route, width: 1920 })
    await flushPromises()
    return { ...mounted, store: usePreferencesStore() }
  }

  it('loads preferences and opens General by default', async () => {
    const { wrapper } = await render()
    expect(api.fetchPreferences).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-test="household-name"]').exists()).toBe(true)
    const active = wrapper.find('[data-test="settings-nav"] .v-list-item--active')
    expect(active.text()).toBe('General')
    wrapper.unmount()
  })

  it('does not reload preferences it already has', async () => {
    const { wrapper } = await mountWithPlugins(SettingsView, {
      route: '/settings/alerts',
      beforeMount: () => {
        const store = usePreferencesStore()
        store.saved = makePreferences()
        store.draft = makePreferences()
      },
    })
    expect(api.fetchPreferences).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="alert-budget"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('opens the section named in the URL, with links to every section', async () => {
    const { wrapper, router } = await render('/settings/sync')
    expect(wrapper.find('[data-test="sync-interval"]').exists()).toBe(true)
    const chips = wrapper.find('[data-test="settings-chips"]').findAll('a')
    expect(chips.map((chip) => chip.attributes('href'))).toContain('/settings/system')
    await router.push('/settings/appearance')
    await flushPromises()
    expect(wrapper.find('[data-test="theme-option-dark"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('falls back to General for an unknown section', async () => {
    const { wrapper } = await render('/settings/bogus')
    expect(wrapper.find('[data-test="household-name"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('groups the sections in the side navigation', async () => {
    const { wrapper } = await render('/settings/account')
    const groups = wrapper.findAll('.settings-nav__group').map((group) => group.text())
    expect(groups).toEqual(['Household', 'You', 'Cashcove'])
    const active = wrapper.find('[data-test="settings-nav"] .v-list-item--active')
    expect(active.attributes('data-test')).toBe('settings-link-account')
    expect(wrapper.find('[data-test="profile-name"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('offers to save changes and confirms when saved', async () => {
    const { wrapper, store } = await render()
    expect(wrapper.find('[data-test="save-bar"]').exists()).toBe(false)
    await wrapper.find('[data-test="household-name"] input').setValue('The Coves')
    expect(wrapper.find('[data-test="save-bar"]').exists()).toBe(true)

    const saved = { ...makePreferences() }
    saved.general.household_name = 'The Coves'
    vi.spyOn(api, 'savePreferences').mockResolvedValue(saved)
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()
    expect(store.dirty).toBe(false)
    expect(notices.value.at(-1)).toMatchObject({ text: 'Settings saved', tone: 'success' })
    expect(wrapper.find('[data-test="save-bar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('reports a failed save and keeps the changes', async () => {
    const { wrapper, store } = await render()
    await wrapper.find('[data-test="household-name"] input').setValue('The Coves')
    vi.spyOn(api, 'savePreferences').mockRejectedValue(new Error('The name is too long.'))
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)).toMatchObject({
      text: "Couldn't save your settings. The name is too long.",
      tone: 'error',
    })
    expect(store.dirty).toBe(true)
    wrapper.unmount()
  })

  it('reports a failed save without a message', async () => {
    const { wrapper, store } = await render()
    await wrapper.find('[data-test="household-name"] input').setValue('The Coves')
    vi.spyOn(store, 'save').mockImplementation(() => {
      store.error = null
      return Promise.resolve(false)
    })
    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()
    expect(notices.value.at(-1)?.text).toBe("Couldn't save your settings.")
    wrapper.unmount()
  })

  it('discards changes', async () => {
    const { wrapper, store } = await render()
    await wrapper.find('[data-test="household-name"] input').setValue('The Coves')
    await wrapper.find('[data-test="discard"]').trigger('click')
    expect(store.draft!.general.household_name).toBe('My household')
    wrapper.unmount()
  })

  it('shows viewers the settings without a way to change them', async () => {
    const { wrapper, store } = await mountWithPlugins(SettingsView, {
      route: '/settings',
      width: 1920,
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    }).then(async (mounted) => {
      await flushPromises()
      return { ...mounted, store: usePreferencesStore() }
    })
    expect(wrapper.find('[data-test="read-only-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="household-name"] input').attributes('readonly')).toBeDefined()
    // Even a change made some other way offers nothing to save.
    store.draft!.general.household_name = 'The Coves'
    await flushPromises()
    expect(wrapper.find('[data-test="save-bar"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
