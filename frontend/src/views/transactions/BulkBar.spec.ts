import { mountWithPlugins } from '@/test/mount'
import BulkBar from '@/views/transactions/BulkBar.vue'

describe('BulkBar', () => {
  it('says how many are selected and offers what can be done with them', async () => {
    const { wrapper } = await mountWithPlugins(BulkBar, { props: { count: 3, payments: 2 } })
    expect(wrapper.text()).toContain('3 selected')

    await wrapper.find('[data-test="bulk-categorize"]').trigger('click')
    await wrapper.find('[data-test="bulk-link"]').trigger('click')
    await wrapper.find('[data-test="bulk-automate"]').trigger('click')
    await wrapper.find('[data-test="bulk-delete"]').trigger('click')
    await wrapper.find('[data-test="bulk-clear"]').trigger('click')

    expect(wrapper.emitted('categorize')).toHaveLength(1)
    expect(wrapper.emitted('link')).toHaveLength(1)
    expect(wrapper.emitted('automate')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('[data-test="bulk-clear"]').attributes('aria-label')).toBe(
      'Clear selection',
    )
  })

  it('has nothing to link to a subscription when none of them went out', async () => {
    const { wrapper } = await mountWithPlugins(BulkBar, { props: { count: 2, payments: 0 } })

    expect(wrapper.find('[data-test="bulk-link"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="bulk-link"]').trigger('click')

    expect(wrapper.emitted('link')).toBeUndefined()
  })
})
