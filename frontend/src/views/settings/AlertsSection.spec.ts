import { flushPromises } from '@/test/mount'
import { mountSection } from '@/test/settings'
import AlertRow from '@/views/settings/AlertRow.vue'
import AlertsSection from '@/views/settings/AlertsSection.vue'

describe('AlertsSection', () => {
  it('lists every alert, switched on by default', async () => {
    const { wrapper } = await mountSection(AlertsSection)
    for (const id of ['subscription', 'low-balance', 'large-transaction', 'budget', 'sync']) {
      const row = wrapper.find(`[data-test="alert-${id}"]`)
      expect(row.exists()).toBe(true)
      expect(row.find('input[type="checkbox"]').element).toHaveProperty('checked', true)
    }
    expect(wrapper.text()).toContain('90%')
    wrapper.unmount()
  })

  it('turning an alert off disables its setting', async () => {
    const { wrapper, preferences } = await mountSection(AlertsSection)
    const row = wrapper.find('[data-test="alert-low-balance"]')
    await row.find('input[type="checkbox"]').setValue(false)
    expect(preferences.draft!.alerts.low_balance_enabled).toBe(false)
    expect(row.find('.alert-row__control').classes()).toContain('is-off')
    expect(row.find('input[inputmode="decimal"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('validates amounts and shows the currency symbol', async () => {
    const { wrapper, preferences } = await mountSection(AlertsSection)
    const row = wrapper.find('[data-test="alert-large-transaction"]')
    expect(row.text()).toContain('$')
    const input = row.find('input[inputmode="decimal"]')
    await input.setValue('12.345')
    await flushPromises()
    expect(row.text()).toContain('Enter an amount like 250 or 99.95')
    await input.setValue('750')
    await flushPromises()
    expect(preferences.draft!.alerts.large_transaction_threshold).toBe('750')
    expect(row.text()).not.toContain('Enter an amount')
    wrapper.unmount()
  })

  it('edits the days before a subscription is due', async () => {
    const { wrapper, preferences } = await mountSection(AlertsSection)
    const row = wrapper.find('[data-test="alert-subscription"]')
    await row.find('input[type="text"], input:not([type])').setValue('7')
    await flushPromises()
    expect(preferences.draft!.alerts.subscription_due_days_before).toBe(7)
    wrapper.unmount()
  })

  it('writes every switch and control back to the draft', async () => {
    const { wrapper, preferences } = await mountSection(AlertsSection)
    const alerts = preferences.draft!.alerts
    await wrapper.findComponent({ name: 'VNumberInput' }).setValue(10)
    await wrapper.findComponent({ name: 'VSlider' }).setValue(120)
    await wrapper
      .find('[data-test="alert-low-balance"]')
      .findComponent({ name: 'VTextField' })
      .setValue('42.50')
    expect(alerts.subscription_due_days_before).toBe(10)
    expect(alerts.budget_threshold_percent).toBe(120)
    expect(alerts.low_balance_threshold).toBe('42.50')

    for (const row of wrapper.findAllComponents(AlertRow)) row.vm.$emit('update:enabled', false)
    await flushPromises()
    expect(
      [
        alerts.subscription_due_enabled,
        alerts.low_balance_enabled,
        alerts.large_transaction_enabled,
        alerts.budget_threshold_enabled,
        alerts.sync_failure_enabled,
      ].some(Boolean),
    ).toBe(false)
    wrapper.unmount()
  })
})
