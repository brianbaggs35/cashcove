import { mountWithPlugins } from '@/test/mount'
import SaveBar from '@/views/settings/SaveBar.vue'

describe('SaveBar', () => {
  it('is hidden when there is nothing to save', async () => {
    const { wrapper } = await mountWithPlugins(SaveBar, {
      props: { visible: false, saving: false },
    })
    expect(wrapper.find('[data-test="save-bar"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('emits save and discard', async () => {
    const { wrapper } = await mountWithPlugins(SaveBar, { props: { visible: true, saving: false } })
    await wrapper.find('[data-test="save"]').trigger('click')
    await wrapper.find('[data-test="discard"]').trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
    expect(wrapper.emitted('discard')).toHaveLength(1)
    wrapper.unmount()
  })
})
