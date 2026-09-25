import * as healthApi from '@/api/health'
import { degradedReport, makeSystemInfo } from '@/test/fixtures'
import { flushPromises } from '@/test/mount'
import { mountSection } from '@/test/settings'
import SystemSection from '@/views/settings/SystemSection.vue'

describe('SystemSection', () => {
  it('shows a healthy install', async () => {
    const { wrapper } = await mountSection(SystemSection)
    const row = (key: string) => wrapper.find(`[data-test="health-${key}"]`).text()
    expect(row('api')).toContain('Healthy')
    expect(row('database')).toContain('Connected')
    expect(row('plaid')).toContain('Not configured')
    expect(row('version')).toContain('0.1.0')
    expect(row('environment')).toContain('production')
    wrapper.unmount()
  })

  it('shows degraded services and a configured Plaid', async () => {
    const { wrapper, health } = await mountSection(SystemSection)
    health.health = degradedReport
    health.system = makeSystemInfo({ configured: true })
    await flushPromises()
    const row = (key: string) => wrapper.find(`[data-test="health-${key}"]`).text()
    expect(row('api')).toContain('Degraded')
    expect(row('database')).toContain('Unavailable')
    expect(row('plaid')).toContain('Configured · sandbox')
    wrapper.unmount()
  })

  it('shows a loader, errors, and refreshes on demand', async () => {
    const { wrapper, health } = await mountSection(SystemSection)
    health.health = null
    await flushPromises()
    expect(wrapper.find('[data-test="health-loading"]').exists()).toBe(true)
    health.error = 'offline'
    await flushPromises()
    expect(wrapper.find('[data-test="health-error"]').text()).toContain('offline')
    const refresh = vi.spyOn(healthApi, 'fetchHealth')
    await wrapper.find('[data-test="refresh-health"]').trigger('click')
    expect(refresh).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
