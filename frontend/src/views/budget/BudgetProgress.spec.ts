import { mountWithPlugins } from '@/test/mount'
import BudgetProgress from '@/views/budget/BudgetProgress.vue'

describe('BudgetProgress', () => {
  it('shows dollars, percentage, remaining amount and an accessible progress bar', async () => {
    const { wrapper } = await mountWithPlugins(BudgetProgress, {
      props: {
        label: 'Groceries',
        used: '45.00',
        limit: '100.00',
        currency: 'USD',
        usedLabel: 'Spent',
      },
    })
    expect(wrapper.find('[data-test="budget-progress-percent"]').text()).toBe('45%')
    expect(wrapper.find('[data-test="budget-progress-amount"]').text()).toContain('$45.00 spent')
    expect(wrapper.text()).toContain('$55.00 left')
    expect(wrapper.find('[data-test="budget-progress-bar"]').attributes('aria-label')).toContain(
      '45 percent',
    )
    wrapper.unmount()
  })

  it('warns near the configured threshold and reports overspending', async () => {
    const { wrapper } = await mountWithPlugins(BudgetProgress, {
      props: {
        label: 'Dining',
        used: '92.00',
        limit: '100.00',
        currency: 'USD',
        thresholdPercent: 90,
      },
    })
    expect(wrapper.find('[data-test="budget-progress-percent"]').classes()).toContain(
      'text-warning',
    )
    await wrapper.setProps({ used: '125.00' })
    expect(wrapper.find('[data-test="budget-progress-percent"]').text()).toBe('125%')
    expect(wrapper.find('[data-test="budget-progress-percent"]').classes()).toContain('text-error')
    expect(wrapper.text()).toContain('$25.00 over')
    wrapper.unmount()
  })

  it('handles a zero limit and negative refunds without a misleading progress bar', async () => {
    const { wrapper } = await mountWithPlugins(BudgetProgress, {
      props: {
        label: 'Travel',
        used: '-5.00',
        limit: '0.00',
        currency: 'USD',
      },
    })
    expect(wrapper.find('[data-test="budget-progress-bar"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="budget-progress-percent"]').text()).toBe('0%')
    expect(wrapper.find('[data-test="budget-progress-amount"]').text()).toContain('$0.00 used')
    expect(wrapper.text()).toContain('No target set')
    wrapper.unmount()
  })
})
