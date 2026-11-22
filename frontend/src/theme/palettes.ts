import type { ThemeDefinition } from 'vuetify'

import palettes from '@/theme/palettes.json'

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

/**
 * The palettes, in the order they are offered, written out in full in `palettes.json`: a color
 * for each of the ten things a palette sets, in its light and in its dark theme.
 *
 * In the light themes, primary, secondary and accent are dark enough for white text on each, and
 * for their own text on their 12% tint, to meet WCAG AA contrast (4.5:1); in the dark ones they
 * are light enough for black text. `high contrast` also sets stronger borders and secondary text.
 */
export const PALETTES = palettes as readonly Palette[]

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
