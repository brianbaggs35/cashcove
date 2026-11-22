import { defineComponent, h, type VNode } from 'vue'
import { VBtn, VBtnToggle, VCombobox, VTextarea } from 'vuetify/components'

import { aliases } from '@/plugins/icons'
import { buildVuetify } from '@/plugins/vuetify'
import { contrast, tint } from '@/test/contrast'
import { mountWithPlugins } from '@/test/mount'
import { applyPalette, PALETTES } from '@/theme/palettes'

/** Renders Vuetify components the way the app sets them up. */
async function show(...nodes: VNode[]) {
  const { wrapper } = await mountWithPlugins(defineComponent({ render: () => h('div', nodes) }))
  return wrapper
}

describe('vuetify plugin', () => {
  it('defines light and dark themes and follows the system by default', () => {
    const vuetify = buildVuetify()
    expect(vuetify.theme.themes.value.light!.dark).toBe(false)
    expect(vuetify.theme.themes.value.dark!.dark).toBe(true)
    expect(vuetify.theme.isSystem.value).toBe(true)
  })

  // Filled buttons and chips put text on the colour; text, tonal buttons and alerts put the
  // colour on the page, the surface or its own 12% tint.
  it.each(['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'error'])(
    'keeps text readable on and in %s in both themes',
    (name) => {
      for (const theme of Object.values(buildVuetify().theme.computedThemes.value)) {
        // Vuetify keeps every computed theme colour as a hex string.
        const colors = theme.colors as Record<string, string>
        const color = colors[name]!
        expect(contrast(colors[`on-${name}`]!, color)).toBeGreaterThanOrEqual(4.5)
        for (const ground of [colors.surface!, colors.background!]) {
          expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5)
          expect(contrast(color, tint(color, ground, 0.12))).toBeGreaterThanOrEqual(4.5)
        }
      }
    },
  )

  // Whatever palette is chosen, the same things stay readable in both of its themes.
  describe.each(PALETTES)('the $title palette', (palette) => {
    const themes = () => {
      const vuetify = buildVuetify()
      applyPalette(vuetify.theme, palette.id)
      return vuetify.theme.computedThemes.value
    }

    it.each(['primary', 'secondary', 'accent', 'success', 'info', 'warning', 'error'])(
      'keeps text readable on and in %s',
      (name) => {
        for (const theme of Object.values(themes())) {
          const colors = theme.colors as Record<string, string>
          const color = colors[name]!
          expect(contrast(colors[`on-${name}`]!, color)).toBeGreaterThanOrEqual(4.5)
          for (const ground of [colors.surface!, colors.background!]) {
            expect(contrast(color, ground)).toBeGreaterThanOrEqual(4.5)
            expect(contrast(color, tint(color, ground, 0.12))).toBeGreaterThanOrEqual(4.5)
          }
        }
      },
    )

    it('keeps text, and the text that is dimmed twice, readable on the page and its surfaces', () => {
      for (const theme of Object.values(themes())) {
        const colors = theme.colors as Record<string, string>
        const dimmed = theme.variables['medium-emphasis-opacity'] as number
        for (const ground of [colors.surface!, colors.background!]) {
          expect(contrast(colors['on-surface']!, ground)).toBeGreaterThanOrEqual(4.5)
          // Hints, labels and subtitles are dimmed, and sit on whatever is under them.
          const faded = tint(colors['on-surface']!, ground, dimmed * 0.87)
          expect(contrast(faded, ground)).toBeGreaterThanOrEqual(4.5)
        }
        expect(
          contrast(colors['on-surface-variant']!, colors['surface-variant']!),
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  })

  it('dims secondary text no further than both themes can read', () => {
    const { light, dark } = buildVuetify().theme.themes.value
    expect(light!.variables['medium-emphasis-opacity']).toBe(0.7)
    expect(dark!.variables['medium-emphasis-opacity']).toBe(0.7)
  })

  it('outlines text areas and comboboxes like every other field', async () => {
    const wrapper = await show(h(VTextarea, { label: 'Notes' }), h(VCombobox, { label: 'Payee' }))
    expect(wrapper.findAll('.v-field--variant-outlined')).toHaveLength(2)
  })

  it('rounds a group of buttons as one control, and a button on its own by itself', async () => {
    const wrapper = await show(
      h(VBtnToggle, null, () => [
        h(VBtn, { value: 'in' }, () => 'Money in'),
        h(VBtn, { value: 'out' }, () => 'Money out'),
      ]),
      h(VBtn, { class: 'alone' }, () => 'Save'),
    )
    expect(wrapper.find('.v-btn-group').classes()).toContain('rounded-lg')
    const grouped = wrapper.findAll('.v-btn-group .v-btn')
    expect(grouped).toHaveLength(2)
    for (const button of grouped) expect(button.classes()).not.toContain('rounded-lg')
    expect(wrapper.find('.alone').classes()).toContain('rounded-lg')
  })

  it('maps every Vuetify icon alias to a Lucide component', () => {
    for (const icon of Object.values(aliases)) {
      expect(icon).toBeTypeOf('function')
    }
  })
})
