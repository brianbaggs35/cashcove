import '@fontsource-variable/inter'
import 'vuetify/styles'
import '@/styles/main.scss'

import { createVuetify } from 'vuetify'

import { aliases, lucide } from '@/plugins/icons'
import { findPalette, DEFAULT_PALETTE, themeOf } from '@/theme/palettes'

export function buildVuetify() {
  const palette = findPalette(DEFAULT_PALETTE)
  return createVuetify({
    // The light and dark themes start as the first palette's; the app gives them another when
    // one is chosen in Settings > Appearance.
    theme: {
      defaultTheme: 'system',
      themes: { light: themeOf(palette, 'light'), dark: themeOf(palette, 'dark') },
    },
    icons: { defaultSet: 'lucide', aliases, sets: { lucide } },
    defaults: {
      VCard: { rounded: 'xl', elevation: 0, border: true },
      VBtn: { rounded: 'lg', style: 'text-transform: none; letter-spacing: normal' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VTextarea: { variant: 'outlined', density: 'comfortable' },
      VSelect: { variant: 'outlined', density: 'comfortable' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable' },
      VCombobox: { variant: 'outlined', density: 'comfortable' },
      VNumberInput: { variant: 'outlined', density: 'comfortable' },
      VChip: { rounded: 'lg' },
      // A group rounds its own outer corners, so its buttons drop theirs and read as one control.
      VBtnGroup: { rounded: 'lg', VBtn: { rounded: undefined } },
    },
  })
}
