import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/preferences'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'

describe('preferences store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  async function loaded() {
    vi.spyOn(api, 'fetchPreferences').mockResolvedValue(makePreferences())
    const store = usePreferencesStore()
    await store.load()
    return store
  }

  it('loads preferences into an independent draft', async () => {
    const store = await loaded()
    expect(store.loading).toBe(false)
    expect(store.draft).toEqual(store.saved)
    expect(store.draft).not.toBe(store.saved)
    expect(store.dirty).toBe(false)
  })

  it('marks edits as dirty and discards them', async () => {
    const store = await loaded()
    store.draft!.general.household_name = 'Changed'
    expect(store.dirty).toBe(true)
    store.discard()
    expect(store.draft!.general.household_name).toBe('My household')
    expect(store.dirty).toBe(false)
  })

  it('discards to nothing before anything has loaded', () => {
    const store = usePreferencesStore()
    store.discard()
    expect(store.draft).toBeNull()
  })

  it('records load errors', async () => {
    vi.spyOn(api, 'fetchPreferences').mockRejectedValue(new Error('offline'))
    const store = usePreferencesStore()
    await store.load()
    expect(store.error).toBe('offline')
    expect(store.loading).toBe(false)
    expect(store.draft).toBeNull()
  })

  it('records non-Error failures', async () => {
    vi.spyOn(api, 'fetchPreferences').mockRejectedValue('nope')
    const store = usePreferencesStore()
    await store.load()
    expect(store.error).toBe('nope')
  })

  it('saves the draft and adopts the server response', async () => {
    const store = await loaded()
    store.draft!.sync.interval_hours = 12
    const response = {
      ...makePreferences(),
      sync: { ...makePreferences().sync, interval_hours: 12 },
    }
    const save = vi.spyOn(api, 'savePreferences').mockResolvedValue(response as api.Preferences)
    const pending = store.save()
    expect(store.saving).toBe(true)
    await expect(pending).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ sync: response.sync }))
    expect(store.saving).toBe(false)
    expect(store.saved).toEqual(response)
    expect(store.dirty).toBe(false)
  })

  it('keeps the draft when saving fails', async () => {
    const store = await loaded()
    store.draft!.general.currency = 'EUR'
    vi.spyOn(api, 'savePreferences').mockRejectedValue(new Error('422'))
    await expect(store.save()).resolves.toBe(false)
    expect(store.error).toBe('422')
    expect(store.draft!.general.currency).toBe('EUR')
    expect(store.dirty).toBe(true)
  })

  it('does nothing when there is no draft to save', async () => {
    const save = vi.spyOn(api, 'savePreferences')
    await expect(usePreferencesStore().save()).resolves.toBe(false)
    expect(save).not.toHaveBeenCalled()
  })
})
