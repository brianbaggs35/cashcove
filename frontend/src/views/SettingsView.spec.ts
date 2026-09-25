import * as healthApi from '@/api/health'
import { useThemeStore } from '@/stores/theme'
import { flushPromises, mountWithPlugins } from '@/test/mount'
import SettingsView from '@/views/SettingsView.vue'

describe('SettingsView', () => {
  it('shows a healthy API and database', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
      status: 'ok',
      version: '0.1.0',
      database: 'ok',
    })
    const { wrapper } = await mountWithPlugins(SettingsView)
    await flushPromises()
    expect(wrapper.find('[data-test="health-api"]').text()).toContain('Healthy')
    expect(wrapper.find('[data-test="health-database"]').text()).toContain('Connected')
    expect(wrapper.text()).toContain('0.1.0')
    wrapper.unmount()
  })

  it('shows a degraded API with the database down', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
      status: 'degraded',
      version: 'unknown',
      database: 'unavailable',
    })
    const { wrapper } = await mountWithPlugins(SettingsView)
    await flushPromises()
    expect(wrapper.find('[data-test="health-api"]').text()).toContain('Degraded')
    expect(wrapper.find('[data-test="health-database"]').text()).toContain('Unavailable')
    wrapper.unmount()
  })

  it('shows a loader, then an error when the API is unreachable, and retries', async () => {
    const fetchHealth = vi
      .spyOn(healthApi, 'fetchHealth')
      .mockRejectedValue(new Error('Failed to fetch'))
    const { wrapper } = await mountWithPlugins(SettingsView)
    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(true)
    await flushPromises()
    expect(wrapper.find('[data-test="health-error"]').text()).toContain('Failed to fetch')
    await wrapper.find('[data-test="refresh-health"]').trigger('click')
    expect(fetchHealth).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('changes the theme preference', async () => {
    vi.spyOn(healthApi, 'fetchHealth').mockResolvedValue({
      status: 'ok',
      version: '0.1.0',
      database: 'ok',
    })
    const { wrapper } = await mountWithPlugins(SettingsView)
    const buttons = wrapper.find('[data-test="theme-choice"]').findAll('button')
    await buttons[1]!.trigger('click')
    expect(useThemeStore().preference).toBe('dark')
    wrapper.unmount()
  })
})
