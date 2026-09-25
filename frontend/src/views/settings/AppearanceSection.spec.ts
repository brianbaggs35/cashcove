import { useThemeStore } from '@/stores/theme'
import { mountSection } from '@/test/settings'
import AppearanceSection from '@/views/settings/AppearanceSection.vue'

describe('AppearanceSection', () => {
  it('marks the current theme and switches on click', async () => {
    const { wrapper } = await mountSection(AppearanceSection)
    const option = (value: string) => wrapper.find(`[data-test="theme-option-${value}"]`)
    // Buttons, so the keyboard can reach them.
    expect(option('system').element.tagName).toBe('BUTTON')
    expect(option('system').attributes('type')).toBe('button')
    expect(option('system').attributes('aria-pressed')).toBe('true')
    expect(option('dark').attributes('aria-pressed')).toBe('false')
    await option('dark').trigger('click')
    expect(useThemeStore().preference).toBe('dark')
    expect(option('dark').attributes('aria-pressed')).toBe('true')
    wrapper.unmount()
  })
})
