import type { SearchFilters } from '@/api/ai'
import { emptyFilters, isFiltered, type TransactionFilters } from '@/views/transactions/view'

/** The tab's filters for what the AI found, which stand in for the ones that were on. */
export function filtersFromSearch(found: SearchFilters): TransactionFilters {
  const dated = found.start !== null || found.end !== null
  return {
    ...emptyFilters(),
    q: found.q,
    accounts: [...found.account_ids],
    categories: [...found.category_ids],
    uncategorized: found.uncategorized,
    period: dated ? 'custom' : 'all',
    start: found.start,
    end: found.end,
    direction: found.direction,
    status: found.status,
    sources: [...found.sources],
    min: found.min_amount,
    max: found.max_amount,
  }
}

/** Whether there was anything in what the AI found to narrow the list by or to order it by. */
export function isUsable(found: SearchFilters): boolean {
  return found.sort !== null || isFiltered(filtersFromSearch(found))
}
