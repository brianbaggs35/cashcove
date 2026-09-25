import CopyField from '@/components/ui/CopyField.vue'
import { stubClipboard } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'

describe('CopyField', () => {
  it('shows the value and copies it', async () => {
    const writeText = stubClipboard()
    const { wrapper } = await mountWithPlugins(CopyField, {
      props: {
        value: 'https://cashcove.example.com/invite#abc',
        label: 'Invitation link',
        testId: 'link',
      },
    })
    expect(wrapper.text()).toContain('Invitation link')
    expect(wrapper.find('[data-test="link-value"]').classes()).toContain('copy-field__value--mono')
    await wrapper.find('[data-test="link-copy"]').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.find('[data-test="link-copy"]').text()).toBe('Copied')
    })
    expect(writeText).toHaveBeenCalledWith('https://cashcove.example.com/invite#abc')
  })

  it('can show plain text without a label', async () => {
    const { wrapper } = await mountWithPlugins(CopyField, {
      props: { value: 'plain', monospace: false },
    })
    expect(wrapper.attributes('data-test')).toBe('copy-field')
    expect(wrapper.find('[data-test="copy-field-value"]').classes()).not.toContain(
      'copy-field__value--mono',
    )
    expect(wrapper.find('.text-label-medium').exists()).toBe(false)
    expect(wrapper.find('[data-test="copy-field-copy"]').text()).toBe('Copy')
  })
})
