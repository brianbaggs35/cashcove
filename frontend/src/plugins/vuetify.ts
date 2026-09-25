import '@fontsource-variable/inter'
import 'vuetify/styles'
import '@/styles/main.scss'

import { createVuetify, type ThemeDefinition } from 'vuetify'

import { aliases, lucide } from '@/plugins/icons'

const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#f5f7fa',
    surface: '#ffffff',
    'surface-variant': '#e8edf3',
    'on-surface-variant': '#334155',
    // Dark enough for white text on each colour, and for each colour's text on its own tonal
    // tint, to meet WCAG AA contrast (4.5:1).
    primary: '#0f716a',
    secondary: '#4f46e5',
    accent: '#854d0e',
    success: '#157439',
    info: '#0369a1',
    warning: '#a54a0b',
    error: '#b91c1c',
  },
  variables: {
    // Vuetify's 0.6 leaves field labels, hints and subtitles, which it dims twice, below
    // WCAG AA contrast (4.5:1) on white. The dark theme already uses 0.7.
    'medium-emphasis-opacity': 0.7,
  },
}

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#0b1120',
    surface: '#111a2e',
    'surface-variant': '#1e293b',
    'on-surface-variant': '#cbd5e1',
    primary: '#2dd4bf',
    secondary: '#a5b4fc',
    accent: '#fbbf24',
    success: '#4ade80',
    info: '#38bdf8',
    warning: '#fbbf24',
    error: '#f87171',
    // Vuetify would put white on this light red, which is hard to read.
    'on-error': '#000000',
  },
}

export function buildVuetify() {
  return createVuetify({
    theme: { defaultTheme: 'system', themes: { light, dark } },
    icons: { defaultSet: 'lucide', aliases, sets: { lucide } },
    defaults: {
      VCard: { rounded: 'xl', elevation: 0, border: true },
      VBtn: { rounded: 'lg', style: 'text-transform: none; letter-spacing: normal' },
      VTextField: { variant: 'outlined', density: 'comfortable' },
      VSelect: { variant: 'outlined', density: 'comfortable' },
      VAutocomplete: { variant: 'outlined', density: 'comfortable' },
      VNumberInput: { variant: 'outlined', density: 'comfortable' },
      VChip: { rounded: 'lg' },
    },
  })
}
