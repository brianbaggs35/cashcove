import { aliases } from '@/plugins/icons'
import { buildVuetify } from '@/plugins/vuetify'
import { contrast, tint } from '@/test/contrast'

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

  it('dims secondary text no further than both themes can read', () => {
    const { light, dark } = buildVuetify().theme.themes.value
    expect(light!.variables['medium-emphasis-opacity']).toBe(0.7)
    expect(dark!.variables['medium-emphasis-opacity']).toBe(0.7)
  })

  it('maps every Vuetify icon alias to a Lucide component', () => {
    for (const icon of Object.values(aliases)) {
      expect(icon).toBeTypeOf('function')
    }
  })
})
