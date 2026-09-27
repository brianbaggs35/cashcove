import { mountWithPlugins } from '@/test/mount'
import BulkBar from '@/views/transactions/BulkBar.vue'

describe('BulkBar', () => {
  it('says how many are selected and offers what can be done with them', async () => {
    const { wrapper } = await mountWithPlugins(BulkBar, { props: { count: 3 } })
    expect(wrapper.text()).toContain('3 selected')

    await wrapper.find('[data-test="bulk-categorize"]').trigger('click')
    await wrapper.find('[data-test="bulk-delete"]').trigger('click')
    await wrapper.find('[data-test="bulk-clear"]').trigger('click')

    expect(wrapper.emitted('categorize')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect(wrapper.find('[data-test="bulk-clear"]').attributes('aria-label')).toBe(
      'Clear selection',
    )
  })
})
