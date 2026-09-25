import { defineComponent, h, ref } from 'vue'

import CodeInput from '@/components/ui/CodeInput.vue'
import { mountWithPlugins } from '@/test/mount'

describe('CodeInput', () => {
  it('fills in the code and says when all six digits are in', async () => {
    const code = ref('')
    const complete = vi.fn()
    const Host = defineComponent({
      render: () =>
        h(CodeInput, {
          modelValue: code.value,
          'onUpdate:modelValue': (value: string) => (code.value = value),
          onComplete: complete,
          autofocus: false,
        }),
    })
    const { wrapper } = await mountWithPlugins(Host)
    const input = wrapper.find('input.v-otp-input__input')
    expect(wrapper.find('[data-test="code-input"]').attributes('aria-label')).toBe('Six-digit code')
    await input.setValue('123456')
    expect(code.value).toBe('123456')
    await vi.waitFor(() => {
      expect(complete).toHaveBeenCalledWith('123456')
    })
  })

  it('can be disabled and show an error', async () => {
    const { wrapper } = await mountWithPlugins(CodeInput, {
      props: { modelValue: '', disabled: true, error: true, label: 'Code' },
    })
    expect(wrapper.find('input.v-otp-input__input').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="code-input"]').attributes('aria-label')).toBe('Code')
  })
})
