import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/budget'
import { useBudgetsStore } from '@/stores/budgets'
import { makeBudget } from '@/test/budgets'

describe('budgets store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the budgets once and finds them by ID', async () => {
    const fetch = vi
      .spyOn(api, 'fetchBudgets')
      .mockResolvedValue([makeBudget(), makeBudget({ id: 'budget-year', name: 'Year' })])
    const store = useBudgetsStore()

    await Promise.all([store.ensureLoaded(), store.load()])
    await store.ensureLoaded()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(store.find('budget-year')?.name).toBe('Year')
    expect(store.find(null)).toBeUndefined()
    expect(store.find('missing')).toBeUndefined()
  })

  it('keeps what went wrong, and loads again when asked', async () => {
    const fetch = vi
      .spyOn(api, 'fetchBudgets')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue([makeBudget()])
    const store = useBudgetsStore()

    await store.load()

    expect(store.error).toBe('Offline')
    expect(store.loading).toBe(false)
    expect(store.loaded).toBe(false)

    await store.ensureLoaded()
    expect(store.error).toBeNull()
    expect(store.budgets).toHaveLength(1)
    await store.load()
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
