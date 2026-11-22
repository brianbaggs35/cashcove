import type { VueWrapper } from '@vue/test-utils'

import { PALETTE_STORAGE_KEY, useThemeStore } from '@/stores/theme'
import { mountSection } from '@/test/settings'
import { PALETTES } from '@/theme/palettes'
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

  describe('colors', () => {
    const option = (wrapper: VueWrapper, id: string) =>
      wrapper.find(`[data-test="palette-option-${id}"]`)

    it('offers every palette as a button in a group, with what it is like', async () => {
      const { wrapper } = await mountSection(AppearanceSection)

      const group = wrapper.find('[data-test="palette-options"]')
      expect(group.attributes('role')).toBe('group')
      expect(group.attributes('aria-label')).toBe('Color theme')
      const cards = group.findAll('button')
      expect(cards).toHaveLength(PALETTES.length)
      for (const [index, palette] of PALETTES.entries()) {
        const card = cards[index]!
        expect(card.attributes('type')).toBe('button')
        expect(card.attributes('data-test')).toBe(`palette-option-${palette.id}`)
        expect(card.text()).toContain(palette.title)
        expect(card.text()).toContain(palette.description)
        // Three colours of it, as dots.
        expect(card.findAll('.palette-swatch')).toHaveLength(3)
      }
      wrapper.unmount()
    })

    it('marks the palette being worn, and changes it on click', async () => {
      const { wrapper } = await mountSection(AppearanceSection)
      const store = useThemeStore()
      expect(option(wrapper, 'cashcove').attributes('aria-pressed')).toBe('true')
      expect(option(wrapper, 'forest').attributes('aria-pressed')).toBe('false')
      expect(wrapper.findAll('[data-test="palette-selected"]')).toHaveLength(1)

      await option(wrapper, 'forest').trigger('click')

      expect(store.palette).toBe('forest')
      expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('forest')
      expect(option(wrapper, 'forest').attributes('aria-pressed')).toBe('true')
      expect(option(wrapper, 'cashcove').attributes('aria-pressed')).toBe('false')
      expect(wrapper.findAll('[data-test="palette-selected"]')).toHaveLength(1)
      // Choosing a palette leaves light or dark as it was.
      expect(store.preference).toBe('system')
      wrapper.unmount()
    })

    it('shows the palettes in the theme being worn', async () => {
      const { wrapper, vuetify } = await mountSection(AppearanceSection)
      const background = () =>
        option(wrapper, 'ocean').find('.theme-preview__layer').attributes('style')

      expect(background()).toContain('--bg: #f1f6fb')
      expect(background()).toContain('--accent: #0b5cad')

      await vuetify.theme.change('dark')
      await wrapper.vm.$nextTick()

      expect(background()).toContain('--bg: #08121f')
      expect(background()).toContain('--accent: #60a5fa')
      wrapper.unmount()
    })

    it('shows light, dark and match device in the palette being worn', async () => {
      const { wrapper } = await mountSection(AppearanceSection)
      const layers = (value: string) =>
        wrapper.find(`[data-test="theme-option-${value}"]`).findAll('.theme-preview__layer')
      expect(layers('light')[0]!.attributes('style')).toContain('--accent: #0f716a')

      useThemeStore().setPalette('berry')
      await wrapper.vm.$nextTick()

      expect(layers('light')).toHaveLength(1)
      expect(layers('light')[0]!.attributes('style')).toContain('--accent: #a21caf')
      expect(layers('dark')).toHaveLength(1)
      expect(layers('dark')[0]!.attributes('style')).toContain('--accent: #e879f9')
      // Match device is both, split along the diagonal.
      expect(layers('system')).toHaveLength(2)
      expect(layers('system')[0]!.attributes('style')).toContain('--accent: #a21caf')
      expect(layers('system')[1]!.attributes('style')).toContain('--accent: #e879f9')
      expect(layers('system')[1]!.classes()).toContain('theme-preview__layer--far')
      wrapper.unmount()
    })
  })
})
