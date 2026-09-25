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
    primary: '#0d9488',
    secondary: '#6366f1',
    accent: '#f59e0b',
    success: '#16a34a',
    info: '#0284c7',
    warning: '#d97706',
    error: '#dc2626',
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
      VChip: { rounded: 'lg' },
    },
  })
}
