import { defineComponent, h } from 'vue'

import * as api from '@/api/preferences'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import PreferencesGate from '@/views/settings/PreferencesGate.vue'

const Probe = defineComponent({
  render: () =>
    h(PreferencesGate, null, {
      default: ({ draft }: { draft: api.Preferences }) =>
        h('p', { class: 'probe' }, draft.general.household_name),
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
})
