import { defineComponent, h } from 'vue'

import * as api from '@/api/preferences'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences, makeSessionState, makeUser } from '@/test/fixtures'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'

const Probe = defineComponent({
  render: () =>
    h(PreferencesGate, null, {
      default: ({ draft, readonly }: { draft: api.Preferences; readonly: boolean }) =>
        h('p', { class: 'probe', 'data-readonly': String(readonly) }, draft.general.household_name),
    }),
})

describe('PreferencesGate', () => {
  it('shows a loader until preferences arrive, then the form', async () => {
    const { wrapper } = await mountWithPlugins(Probe)
    expect(wrapper.find('[data-test="preferences-loading"]').exists()).toBe(true)
    usePreferencesStore().draft = makePreferences()
    await flushPromises()
    expect(wrapper.find('.probe').text()).toBe('My household')
    wrapper.unmount()
  })

  it('shows errors with a retry', async () => {
    const { wrapper } = await mountWithPlugins(Probe)
    const store = usePreferencesStore()
    store.error = 'offline'
    await flushPromises()
    expect(wrapper.find('[data-test="preferences-error"]').text()).toContain('offline')
    const fetch = vi.spyOn(api, 'fetchPreferences').mockResolvedValue(makePreferences())
    await wrapper.find('[data-test="preferences-retry"]').trigger('click')
    await flushPromises()
    expect(fetch).toHaveBeenCalledOnce()
    expect(wrapper.find('.probe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('lets admins edit, and submitting the form does nothing by itself', async () => {
    const { wrapper } = await mountWithPlugins(Probe)
    usePreferencesStore().draft = makePreferences()
    await flushPromises()
    expect(wrapper.find('.probe').attributes('data-readonly')).toBe('false')
    expect(wrapper.find('[data-test="read-only-notice"]').exists()).toBe(false)
    await wrapper.find('[data-test="preferences-form"]').trigger('submit')
    expect(wrapper.find('.probe').exists()).toBe(true)
    wrapper.unmount()
  })

  it('makes the form read-only for viewers and says why', async () => {
    const { wrapper } = await mountWithPlugins(Probe, {
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    })
    usePreferencesStore().draft = makePreferences()
    await flushPromises()
    expect(wrapper.find('.probe').attributes('data-readonly')).toBe('true')
    expect(wrapper.find('[data-test="read-only-notice"]').text()).toContain(
      'Only an admin can change them',
    )
    wrapper.unmount()
  })
})
