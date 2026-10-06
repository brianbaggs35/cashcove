import { mountWithPlugins } from '@/test/mount'
import SecretField from '@/components/ui/SecretField.vue'

async function render(props: Record<string, unknown> = {}) {
  const { wrapper } = await mountWithPlugins(SecretField, {
    props: { label: 'API key', modelValue: '', ...props },
  })
  return wrapper
}

describe('SecretField', () => {
  it('hides what is typed, and keeps it from password managers', async () => {
    const wrapper = await render({ testId: 'ai-key' })
    const input = wrapper.find('input')

    expect(input.attributes('type')).toBe('password')
    expect(input.attributes('autocomplete')).toBe('off')
    expect(input.attributes('autocapitalize')).toBe('off')
    expect(input.attributes('spellcheck')).toBe('false')
    expect(wrapper.find('label').text()).toBe('API key')
    expect(wrapper.find('[data-test="ai-key"]').exists()).toBe(true)
  })

  it('shows what was typed when asked, and says so for anyone not looking', async () => {
    const wrapper = await render()
    const toggle = wrapper.find('[data-test="secret-toggle"]')
    expect(toggle.attributes('aria-label')).toBe('Show the api key')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')

    expect(wrapper.find('input').attributes('type')).toBe('text')
    expect(toggle.attributes('aria-label')).toBe('Hide the api key')
    expect(toggle.attributes('aria-pressed')).toBe('true')

    await toggle.trigger('click')
    expect(wrapper.find('input').attributes('type')).toBe('password')
  })

  it('passes what is typed on', async () => {
    const wrapper = await render()

    await wrapper.find('input').setValue('sk-test-key')

    expect(wrapper.emitted('update:modelValue')).toEqual([['sk-test-key']])
  })

  it('shows a hint, and what is wrong', async () => {
    const hinted = await render({ hint: 'A key is saved.' })
    expect(hinted.text()).toContain('A key is saved.')

    const wrong = await render({ errorMessages: ['Too short.'] })
    expect(wrong.text()).toContain('Too short.')
  })
})
