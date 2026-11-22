import { defineStore } from 'pinia'
import { ref } from 'vue'

import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from '@/theme/palettes'

export type ThemePreference = 'light' | 'dark' | 'system'

export const THEME_STORAGE_KEY = 'cashcove.theme'
export const PALETTE_STORAGE_KEY = 'cashcove.palette'
const PREFERENCES: ReadonlySet<unknown> = new Set<ThemePreference>(['light', 'dark', 'system'])

function isPreference(value: unknown): value is ThemePreference {
  return PREFERENCES.has(value)
}

/** What was saved under a key on this device, if it is something `accept` takes. */
function readStored<T>(key: string, accept: (value: unknown) => value is T, fallback: T): T {
  try {
    const stored = localStorage.getItem(key)
    return accept(stored) ? stored : fallback
  } catch {
    return fallback
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this visit.
  }
}

/**
 * How the app looks on this device: light, dark or following the device, and which colour
 * palette it wears. Both are kept on the device, not on the account.
 */
export const useThemeStore = defineStore('theme', () => {
  const preference = ref<ThemePreference>(readStored(THEME_STORAGE_KEY, isPreference, 'system'))
  const palette = ref<PaletteId>(readStored(PALETTE_STORAGE_KEY, isPaletteId, DEFAULT_PALETTE))

  function setPreference(value: ThemePreference) {
    preference.value = value
    store(THEME_STORAGE_KEY, value)
  }

  function setPalette(value: PaletteId) {
    palette.value = value
    store(PALETTE_STORAGE_KEY, value)
  }

  return { preference, palette, setPreference, setPalette }
})
