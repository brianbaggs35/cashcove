import type { SearchFilters } from '@/api/ai'
import { filtersFromSearch, isUsable } from '@/views/transactions/searchFilters'
import { emptyFilters } from '@/views/transactions/view'

const nothing: SearchFilters = {
  q: '',
  account_ids: [],
  category_ids: [],
  uncategorized: false,
  start: null,
  end: null,
  direction: null,
  status: null,
  sources: [],
  min_amount: null,
  max_amount: null,
  sort: null,
}

describe('what the AI found, as the Transactions tab’s filters', () => {
  it('is no filters when it found nothing', () => {
    expect(filtersFromSearch(nothing)).toEqual(emptyFilters())
    expect(isUsable(nothing)).toBe(false)
  })

  it('is each of the filters it found, with the days as a custom period', () => {
    const found: SearchFilters = {
      q: 'starbucks',
      account_ids: ['account-visa'],
      category_ids: ['category-coffee'],
      uncategorized: true,
      start: '2026-08-01',
      end: '2026-08-31',
      direction: 'out',
      status: 'pending',
      sources: ['file'],
      min_amount: '5.00',
      max_amount: '50.00',
      sort: 'amount',
    }

    const filters = filtersFromSearch(found)

    expect(filters).toEqual({
      q: 'starbucks',
      accounts: ['account-visa'],
      categories: ['category-coffee'],
      uncategorized: true,
      period: 'custom',
      start: '2026-08-01',
      end: '2026-08-31',
      direction: 'out',
      status: 'pending',
      sources: ['file'],
      importId: null,
      subscriptionId: null,
      min: '5.00',
      max: '50.00',
    })
    // The lists are the tab's own, so changing a filter doesn't change what the AI found.
    expect(filters.categories).not.toBe(found.category_ids)
    expect(isUsable(found)).toBe(true)
  })

  it('has a custom period when only one end of it was given', () => {
    expect(filtersFromSearch({ ...nothing, start: '2026-08-01' }).period).toBe('custom')
    expect(filtersFromSearch({ ...nothing, end: '2026-08-31' }).period).toBe('custom')
  })

  it.each([
    ['words', { q: 'taqueria' }],
    ['a category', { category_ids: ['category-coffee'] }],
    ['uncategorized', { uncategorized: true }],
    ['an amount', { max_amount: '20.00' }],
    ['an order alone', { sort: '-date' as const }],
  ])('is usable with %s', (_, changes) => {
    expect(isUsable({ ...nothing, ...changes })).toBe(true)
  })
})
