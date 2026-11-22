import type { ThemeDefinition } from 'vuetify'

/**
 * The colour themes to choose from in Settings > Appearance. A palette gives the light and the
 * dark theme their own colours, so each one works with Light, Dark and Match device alike.
 *
 * Every colour that carries text, or sits under it, keeps WCAG AA contrast (4.5:1): a colour on
 * the page and on the surface, on its own 12% tint, and the text on it (see `vuetify.spec.ts`,
 * which checks all of them). Success, info, warning and error mean the same in every palette,
 * so they are shared. The surfaces stay close to white and to the deep blue-black of the first
 * palette, which the charts' colours (`styles/main.scss`) were checked against.
 */

export type ThemeScheme = 'light' | 'dark'

export type PaletteId =
  'cashcove' | 'ocean' | 'forest' | 'berry' | 'sunset' | 'graphite' | 'contrast'

/** What a palette sets in one of its themes; the rest comes from `SHARED`. */
interface PaletteColors {
  background: string
  surface: string
  'surface-variant': string
  'on-surface-variant': string
  primary: string
  secondary: string
  accent: string
  'on-primary': string
  'on-secondary': string
  'on-accent': string
}

export interface Palette {
  id: PaletteId
  title: string
  description: string
  light: PaletteColors
  dark: PaletteColors
  /** Vuetify's theme variables, such as how strong the borders are, where a palette sets them. */
  variables?: Partial<Record<ThemeScheme, Record<string, number>>>
}

/** Meaning rather than style: the same in every palette. */
const SHARED: Record<ThemeScheme, Record<string, string>> = {
  light: { success: '#157439', info: '#0369a1', warning: '#a54a0b', error: '#b91c1c' },
  dark: {
    success: '#4ade80',
    info: '#38bdf8',
    warning: '#fbbf24',
    error: '#f87171',
    // Vuetify would put white on this light red, which is hard to read.
    'on-error': '#000000',
  },
}

// The variables a palette may change, with what they are unless it does. Switching palettes
// writes all of them, so nothing one palette set is left behind by the next.
const BASE_VARIABLES: Record<ThemeScheme, Record<string, number>> = {
  // Vuetify's 0.6 leaves field labels, hints and subtitles, which it dims twice, below
  // WCAG AA contrast (4.5:1) on white. The dark theme already uses 0.7.
  light: { 'border-opacity': 0.12, 'medium-emphasis-opacity': 0.7 },
  dark: { 'border-opacity': 0.12, 'medium-emphasis-opacity': 0.7 },
}

export const DEFAULT_PALETTE: PaletteId = 'cashcove'

export const PALETTES: readonly Palette[] = [
  {
    id: 'cashcove',
    title: 'Cashcove',
    description: 'The original: calm teal on cool grays.',
    light: {
      background: '#f5f7fa',
      surface: '#ffffff',
      'surface-variant': '#e8edf3',
      'on-surface-variant': '#334155',
      // Dark enough for white text on each colour, and for each colour's text on its own tonal
      // tint, to meet WCAG AA contrast (4.5:1).
      primary: '#0f716a',
      secondary: '#4f46e5',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#0b1120',
      surface: '#111a2e',
      'surface-variant': '#1e293b',
      'on-surface-variant': '#cbd5e1',
      primary: '#2dd4bf',
      secondary: '#a5b4fc',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'ocean',
    title: 'Ocean',
    description: 'Clear blues over cool, bright surfaces.',
    light: {
      background: '#f1f6fb',
      surface: '#ffffff',
      'surface-variant': '#e2ebf5',
      'on-surface-variant': '#2e3f55',
      primary: '#0b5cad',
      secondary: '#155e75',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#08121f',
      surface: '#0f1d31',
      'surface-variant': '#1b2d47',
      'on-surface-variant': '#cbd5e1',
      primary: '#60a5fa',
      secondary: '#22d3ee',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'forest',
    title: 'Forest',
    description: 'Deep greens, easy on the eyes.',
    light: {
      background: '#f2f7f2',
      surface: '#ffffff',
      'surface-variant': '#e1ecde',
      'on-surface-variant': '#2f4237',
      primary: '#166534',
      secondary: '#3f6212',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#09130d',
      surface: '#0f1f15',
      'surface-variant': '#1a3223',
      'on-surface-variant': '#cfe3d4',
      primary: '#4ade80',
      secondary: '#a3e635',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'berry',
    title: 'Berry',
    description: 'Fuchsia and violet with a soft blush.',
    light: {
      background: '#faf4f9',
      surface: '#ffffff',
      'surface-variant': '#f0e1ee',
      'on-surface-variant': '#4a2a47',
      primary: '#a21caf',
      secondary: '#6d28d9',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#150a19',
      surface: '#211028',
      'surface-variant': '#3a1f40',
      'on-surface-variant': '#e9d5f0',
      primary: '#e879f9',
      secondary: '#c4b5fd',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'sunset',
    title: 'Sunset',
    description: 'Warm orange and rose on a warm paper tone.',
    light: {
      background: '#fdf6f0',
      surface: '#ffffff',
      'surface-variant': '#f5e6da',
      'on-surface-variant': '#4a3426',
      primary: '#b23c0a',
      secondary: '#be123c',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#170e0a',
      surface: '#24150f',
      'surface-variant': '#3a2418',
      'on-surface-variant': '#f1d9c9',
      primary: '#fb923c',
      secondary: '#fb7185',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'graphite',
    title: 'Graphite',
    description: 'Neutral grays that let the numbers stand out.',
    light: {
      background: '#f4f4f5',
      surface: '#ffffff',
      'surface-variant': '#e4e4e7',
      'on-surface-variant': '#3f3f46',
      primary: '#3f3f46',
      secondary: '#52525b',
      accent: '#854d0e',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#09090b',
      surface: '#18181b',
      'surface-variant': '#27272a',
      'on-surface-variant': '#d4d4d8',
      primary: '#e4e4e7',
      secondary: '#a1a1aa',
      accent: '#fbbf24',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
  },
  {
    id: 'contrast',
    title: 'High contrast',
    description: 'Black and white with strong colours and borders.',
    light: {
      background: '#ffffff',
      surface: '#ffffff',
      'surface-variant': '#e6e6e6',
      'on-surface-variant': '#000000',
      primary: '#0030c0',
      secondary: '#6b0f9e',
      accent: '#6b3a00',
      'on-primary': '#ffffff',
      'on-secondary': '#ffffff',
      'on-accent': '#ffffff',
    },
    dark: {
      background: '#000000',
      surface: '#0a0a0a',
      'surface-variant': '#1f1f1f',
      'on-surface-variant': '#ffffff',
      primary: '#ffd60a',
      secondary: '#7dd3fc',
      accent: '#ff9f43',
      'on-primary': '#000000',
      'on-secondary': '#000000',
      'on-accent': '#000000',
    },
    // Borders and secondary text stay strong rather than faint.
    variables: {
      light: { 'border-opacity': 0.6, 'medium-emphasis-opacity': 0.87 },
      dark: { 'border-opacity': 0.6, 'medium-emphasis-opacity': 0.87 },
    },
  },
]

const BY_ID = Object.fromEntries(PALETTES.map((palette) => [palette.id, palette])) as Record<
  PaletteId,
  Palette
>

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && Object.hasOwn(BY_ID, value)
}

export function findPalette(id: PaletteId): Palette {
  return BY_ID[id]
}

/** One of a palette's two themes, as Vuetify takes it. */
export function themeOf(palette: Palette, scheme: ThemeScheme): ThemeDefinition {
  return {
    dark: scheme === 'dark',
    colors: { ...SHARED[scheme], ...palette[scheme] },
    variables: { ...BASE_VARIABLES[scheme], ...palette.variables?.[scheme] },
  }
}

/** The part of Vuetify's theme the app changes: its themes, by name. */
interface Themes {
  themes: { value: Record<string, ThemeDefinition> }
}

const NO_THEME: ThemeDefinition = { colors: {}, variables: {} }

/**
 * Gives the light and dark themes a palette's colours, keeping everything else Vuetify put in
 * them. They stay the themes named `light` and `dark`, so Light, Dark and Match device, and
 * every style written for `.v-theme--dark`, work with any palette.
 */
export function applyPalette(theme: Themes, id: PaletteId): void {
  const palette = findPalette(id)
  for (const scheme of ['light', 'dark'] as const) {
    const base = { ...NO_THEME, ...theme.themes.value[scheme] }
    const next = themeOf(palette, scheme)
    theme.themes.value[scheme] = {
      ...base,
      colors: { ...base.colors, ...next.colors },
      variables: { ...base.variables, ...next.variables },
    }
  }
}
