import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/categories'
import { useCategoriesStore } from '@/stores/categories'
import { coffee, makeGroups } from '@/test/finance'

describe('categories store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the groups once and finds categories with their group', async () => {
    const fetch = vi.spyOn(api, 'fetchCategories').mockResolvedValue(makeGroups())
    const store = useCategoriesStore()

    await Promise.all([store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(store.count).toBe(4)
    const found = store.find(coffee.id)
    expect(found?.name).toBe('Coffee')
    expect(found?.group.name).toBe('Food & drink')
    expect(store.find(null)).toBeUndefined()
    expect(store.find('missing')).toBeUndefined()
  })

  it('keeps what went wrong', async () => {
    vi.spyOn(api, 'fetchCategories').mockRejectedValue(new Error('Offline'))
    const store = useCategoriesStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)
  })
})
