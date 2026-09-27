import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import EmojiPicker from '@/components/ui/EmojiPicker.vue'
import { page } from '@/test/dom'
import { mountWithPlugins } from '@/test/mount'

async function render(label?: string) {
  const emoji = ref('🛒')
  const Host = defineComponent({
    render: () =>
      h(EmojiPicker, {
        label,
        modelValue: emoji.value,
        'onUpdate:modelValue': (value: string) => (emoji.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host)
  const button = wrapper.find('[data-test="emoji-picker"]')
  async function open() {
    await button.trigger('click')
    await flushPromises()
  }
  return { emoji, button, open }
}

const menu = () => page().find('[data-test="emoji-menu"]')
const custom = () => menu().find('[data-test="emoji-custom"] input')

describe('EmojiPicker', () => {
  it('shows the emoji and picks another from the set', async () => {
    const { emoji, button, open } = await render('Category emoji')
    expect(button.text()).toBe('🛒')
    expect(button.attributes('aria-label')).toBe('Category emoji: 🛒. Choose another')

    await open()
    const options = menu().findAll('[data-test="emoji-option"]')
    expect(menu().find('[role="group"]').attributes('aria-label')).toBe('Category emoji')
    const current = options.find((option) => option.attributes('aria-pressed') === 'true')!
    expect(current.attributes('aria-label')).toBe('Shopping cart')
    await options.find((option) => option.attributes('aria-label') === 'Coffee')!.trigger('click')
    expect(emoji.value).toBe('☕')
  })

  it('takes any emoji typed in', async () => {
    const { emoji, button, open } = await render()
    expect(button.attributes('aria-label')).toBe('Emoji: 🛒. Choose another')
    await open()
    const use = () => menu().find('[data-test="emoji-custom-use"]')
    expect(use().attributes('disabled')).toBeDefined()

    await custom().setValue(' 🧶 ')
    await use().trigger('click')
    expect(emoji.value).toBe('🧶')

    await open()
    await custom().setValue('🎨')
    await custom().trigger('keydown', { key: 'Enter' })
    expect(emoji.value).toBe('🎨')
  })

  it('ignores text that is not a single emoji', async () => {
    const { emoji, open } = await render()
    await open()
    await custom().setValue('two words')
    await custom().trigger('keydown', { key: 'Enter' })
    await custom().setValue('x'.repeat(17))
    await custom().trigger('keydown', { key: 'Enter' })
    await custom().setValue('   ')
    await custom().trigger('keydown', { key: 'Enter' })
    expect(emoji.value).toBe('🛒')
  })
})
