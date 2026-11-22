import { createPinia, setActivePinia } from 'pinia'

import { PALETTE_STORAGE_KEY, THEME_STORAGE_KEY, useThemeStore } from '@/stores/theme'

describe('theme store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('follows the system theme by default', () => {
    expect(useThemeStore().preference).toBe('system')
  })

  it('restores a saved preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(useThemeStore().preference).toBe('dark')
  })

  it('ignores an invalid saved value', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon')
    expect(useThemeStore().preference).toBe('system')
  })

  it('falls back to system when storage cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(useThemeStore().preference).toBe('system')
  })

  it('saves a new preference', () => {
    const store = useThemeStore()
    store.setPreference('light')
    expect(store.preference).toBe('light')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('still applies a preference when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const store = useThemeStore()
    store.setPreference('dark')
    expect(store.preference).toBe('dark')
  })
})

describe('theme store palette', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts with the original palette', () => {
    expect(useThemeStore().palette).toBe('cashcove')
  })

  it('restores a saved palette', () => {
    localStorage.setItem(PALETTE_STORAGE_KEY, 'forest')
    expect(useThemeStore().palette).toBe('forest')
  })

  it('ignores a palette it does not have, and one that cannot be read', () => {
    localStorage.setItem(PALETTE_STORAGE_KEY, 'neon')
    expect(useThemeStore().palette).toBe('cashcove')

    setActivePinia(createPinia())
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(useThemeStore().palette).toBe('cashcove')
  })

  it('saves a new palette apart from the light or dark preference', () => {
    const store = useThemeStore()
    store.setPreference('dark')
    store.setPalette('sunset')
    expect(store.palette).toBe('sunset')
    expect(localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('sunset')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('still applies a palette when storage cannot be written', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const store = useThemeStore()
    store.setPalette('ocean')
    expect(store.palette).toBe('ocean')
  })
})
