import { flushPromises } from '@/test/mount'
import { makeSystemInfo } from '@/test/fixtures'
import { mountSection } from '@/test/settings'
import SyncSection from '@/views/settings/SyncSection.vue'

describe('SyncSection', () => {
  it('offers every interval and summarises the schedule', async () => {
    const { wrapper } = await mountSection(SyncSection)
    const chips = wrapper.find('[data-test="sync-interval"]').findAll('.v-chip')
    expect(chips.map((chip) => chip.text())).toEqual([
      'Every hour',
      'Every 2 hours',
      'Every 4 hours',
      'Every 6 hours',
      'Every 12 hours',
      'Daily',
    ])
    expect(wrapper.find('[data-test="sync-summary"]').text()).toContain('Every 6 hours')
    wrapper.unmount()
  })

  it('changes the interval', async () => {
    const { wrapper, preferences } = await mountSection(SyncSection)
    const chips = wrapper.find('[data-test="sync-interval"]').findAll('.v-chip')
    await chips[5]!.trigger('click')
    expect(preferences.draft!.sync.interval_hours).toBe(24)
    expect(wrapper.find('[data-test="sync-summary"]').text()).toContain('Daily')
    await chips[0]!.trigger('click')
    expect(wrapper.find('[data-test="sync-summary"]').text()).toContain('Every hour')
    wrapper.unmount()
  })

  it('explains manual syncing when automatic sync is off', async () => {
    const { wrapper, preferences } = await mountSection(SyncSection)
    await wrapper.find('[data-test="auto-sync"] input').setValue(false)
    expect(preferences.draft!.sync.auto_sync).toBe(false)
    expect(wrapper.find('[data-test="sync-summary"]').text()).toContain('Automatic sync is off')
    wrapper.unmount()
  })

  it('shows and changes how much history to import', async () => {
    const { wrapper, preferences } = await mountSection(SyncSection)
    expect(wrapper.find('[data-test="history-days"]').text()).toContain('Last 2 years')
    await wrapper.findComponent({ name: 'VSelect' }).setValue(90)
    expect(preferences.draft!.sync.history_days).toBe(90)
    wrapper.unmount()
  })

  it('explains how to configure Plaid when it is missing', async () => {
    const { wrapper } = await mountSection(SyncSection)
    expect(wrapper.find('[data-test="plaid-status"]').text()).toBe('Not configured')
    expect(wrapper.find('[data-test="plaid-setup"]').text()).toContain('CASHCOVE_PLAID_SECRET')
    wrapper.unmount()
  })

  it('shows a configured Plaid environment', async () => {
    const { wrapper, health } = await mountSection(SyncSection)
    health.system = makeSystemInfo({ configured: true, environment: 'production' })
    await flushPromises()
    expect(wrapper.find('[data-test="plaid-status"]').text()).toBe('Ready · production')
    expect(wrapper.find('[data-test="plaid-setup"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('hides the Plaid status until it is known', async () => {
    const { wrapper, health } = await mountSection(SyncSection)
    health.system = null
    await flushPromises()
    expect(wrapper.find('[data-test="plaid-status"]').exists()).toBe(false)
    wrapper.unmount()
  })
})
