import StatusIndicator from '@/components/StatusIndicator.vue'
import { useHealthStore } from '@/stores/health'
import { degradedReport, healthyReport } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'

describe('StatusIndicator', () => {
  async function render() {
    const { wrapper } = await mountWithPlugins(StatusIndicator)
    return { wrapper, store: useHealthStore() }
  }

  it('shows a neutral state while checking', async () => {
    const { wrapper } = await render()
    expect(wrapper.text()).toContain('Checking status')
    expect(wrapper.find('.bg-grey').exists()).toBe(true)
    expect(wrapper.attributes('href')).toBe('/settings/system')
    wrapper.unmount()
  })

  it.each([
    ['healthy', healthyReport, null, 'All systems normal', 'bg-success'],
    ['degraded', degradedReport, null, 'Database unavailable', 'bg-warning'],
    ['unreachable', null, 'offline', 'API unreachable', 'bg-error'],
  ] as const)('shows the %s state', async (_, health, error, label, dotClass) => {
    const { wrapper, store } = await render()
    store.health = health
    store.error = error
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain(label)
    expect(wrapper.find(`.${dotClass}`).exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the version once known', async () => {
    const { wrapper, store } = await render()
    store.health = healthyReport
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Version 0.1.0')
    wrapper.unmount()
  })
})
