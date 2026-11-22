import { toRaw } from 'vue'

import { buildVuetify } from '@/plugins/vuetify'
import {
  applyPalette,
  DEFAULT_PALETTE,
  findPalette,
  isPaletteId,
  PALETTES,
  themeOf,
} from '@/theme/palettes'

describe('palettes', () => {
  it('lists each palette once, starting with the original, with something to say about it', () => {
    const ids = PALETTES.map((palette) => palette.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids[0]).toBe(DEFAULT_PALETTE)
    expect(ids).toEqual(['cashcove', 'ocean', 'forest', 'berry', 'sunset', 'graphite', 'contrast'])
    for (const palette of PALETTES) {
      expect(palette.title).not.toBe('')
      expect(palette.description).not.toBe('')
    }
  })

  it('knows its own ids and nothing else', () => {
    for (const palette of PALETTES) expect(isPaletteId(palette.id)).toBe(true)
    for (const other of ['neon', '', 'toString', '__proto__', null, undefined, 3, {}]) {
      expect(isPaletteId(other)).toBe(false)
    }
  })

  it('finds a palette by its id', () => {
    for (const palette of PALETTES) expect(findPalette(palette.id)).toBe(palette)
  })

  it('makes a light and a dark theme of a palette, with the colours that mean the same in all', () => {
    const ocean = findPalette('ocean')
    const light = themeOf(ocean, 'light')
    const dark = themeOf(ocean, 'dark')
    expect(light.dark).toBe(false)
    expect(dark.dark).toBe(true)
    expect(light.colors).toMatchObject({ primary: '#0b5cad', error: '#b91c1c' })
    expect(dark.colors).toMatchObject({
      primary: '#60a5fa',
      error: '#f87171',
      'on-error': '#000000',
    })
    const variables = { 'border-opacity': 0.12, 'medium-emphasis-opacity': 0.7 }
    expect(light.variables).toEqual(variables)
    expect(dark.variables).toEqual(variables)
  })

  it('keeps the original as it always was', () => {
    const original = findPalette(DEFAULT_PALETTE)
    expect(themeOf(original, 'light').colors).toEqual({
      success: '#157439',
      info: '#0369a1',
      warning: '#a54a0b',
      error: '#b91c1c',
      background: '#f5f7fa',
      surface: '#ffffff',
      'surface-variant': '#e8edf3',
      'on-surface-variant': '#334155',
      primary: '#0f716a',
      secondary: '#4f46e5',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    })
    expect(themeOf(original, 'dark').colors).toMatchObject({
      background: '#0b1120',
      surface: '#111a2e',
      primary: '#2dd4bf',
      accent: '#fbbf24',
      'on-primary': '#000000',
    })
  })

  it('gives high contrast stronger borders and secondary text in both themes', () => {
    const strong = findPalette('contrast')
    for (const scheme of ['light', 'dark'] as const) {
      expect(themeOf(strong, scheme).variables).toEqual({
        'border-opacity': 0.6,
        'medium-emphasis-opacity': 0.87,
      })
    }
  })

  describe('applying one', () => {
    const colors = (vuetify: ReturnType<typeof buildVuetify>, name: 'light' | 'dark') =>
      vuetify.theme.computedThemes.value[name]!

    it('recolours the light and dark themes, keeping their names and everything else in them', () => {
      const vuetify = buildVuetify()
      const before = colors(vuetify, 'light')

      applyPalette(vuetify.theme, 'berry')

      const light = colors(vuetify, 'light')
      const dark = colors(vuetify, 'dark')
      expect(light.colors.primary).toBe('#a21caf')
      expect(light.colors['on-primary']).toBe('#ffffff')
      expect(dark.colors.primary).toBe('#e879f9')
      expect(light.dark).toBe(false)
      expect(dark.dark).toBe(true)
      // What the palette doesn't set is what Vuetify made it.
      expect(light.colors['on-surface']).toBe(before.colors['on-surface'])
      expect(light.colors['surface-bright']).toBe(before.colors['surface-bright'])
      expect(Object.keys(vuetify.theme.themes.value).sort()).toEqual(['dark', 'light'])
    })

    it('leaves nothing of the last palette behind', () => {
      const vuetify = buildVuetify()
      const original = structuredClone(toRaw(vuetify.theme.computedThemes.value))

      applyPalette(vuetify.theme, 'contrast')
      expect(colors(vuetify, 'light').variables['border-opacity']).toBe(0.6)
      expect(colors(vuetify, 'dark').colors.primary).toBe('#ffd60a')
      applyPalette(vuetify.theme, 'cashcove')

      expect(vuetify.theme.computedThemes.value).toEqual(original)
    })

    it('can start from themes that are not there yet', () => {
      const bare: Parameters<typeof applyPalette>[0] = { themes: { value: {} } }

      applyPalette(bare, 'ocean')

      expect(Object.keys(bare.themes.value).sort()).toEqual(['dark', 'light'])
    })
  })
})
