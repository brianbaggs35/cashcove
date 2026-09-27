import { computed } from 'vue'
import { useRoute, useRouter, type LocationQuery, type LocationQueryRaw } from 'vue-router'

import type { TransactionQuery, TransactionSort, TransactionSource } from '@/api/transactions'
import { periodRange, periods, type PeriodKey } from '@/utils/dates'
import { parseAmount } from '@/utils/money'

// What the Transactions tab shows lives in its address, so a filtered list can be bookmarked,
// shared, or linked to, e.g. from an account: /transactions?account=…

export type Direction = 'in' | 'out'
export type Status = 'pending' | 'posted'

export interface TransactionFilters {
  q: string
  accounts: string[]
  categories: string[]
  uncategorized: boolean
  /** A period counted from today, or `custom` for the days in `start` and `end`. */
  period: PeriodKey | 'custom'
  start: string | null
  end: string | null
  direction: Direction | null
  status: Status | null
  sources: TransactionSource[]
  /** However the money went, e.g. 50 matches both 50.00 in and 50.00 out. */
  min: string | null
  max: string | null
}

export interface TransactionView {
  filters: TransactionFilters
  sort: TransactionSort
  page: number
  pageSize: number
}

export const PAGE_SIZES = [25, 50, 100, 200] as const
const SORTS: TransactionSort[] = ['-date', 'date', '-amount', 'amount', 'payee', '-payee']
const SOURCES = new Set<TransactionSource>(['manual', 'plaid', 'file'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

type QueryValue = LocationQuery[string] | undefined

export function emptyFilters(): TransactionFilters {
  return {
    q: '',
    accounts: [],
    categories: [],
    uncategorized: false,
    period: 'all',
    start: null,
    end: null,
    direction: null,
    status: null,
    sources: [],
    min: null,
    max: null,
  }
}

/** A copy of the filters that shares none of their lists, so changing one leaves the other. */
export function copyFilters(filters: TransactionFilters): TransactionFilters {
  return {
    ...filters,
    accounts: [...filters.accounts],
    categories: [...filters.categories],
    sources: [...filters.sources],
  }
}

export const defaultView = (): TransactionView => ({
  filters: emptyFilters(),
  sort: '-date',
  page: 1,
  pageSize: 50,
})

function list(value: QueryValue): string[] {
  return (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string' && item !== '',
  )
}

function one(value: QueryValue): string | null {
  return list(value)[0] ?? null
}

function pick<T extends string>(value: QueryValue, allowed: readonly T[]): T | null {
  const text = one(value)
  return allowed.find((item) => item === text) ?? null
}

function whole(value: QueryValue, fallback: number, max: number): number {
  const number = Number(one(value))
  return Number.isInteger(number) && number >= 1 && number <= max ? number : fallback
}

function amount(value: QueryValue): string | null {
  const parsed = parseAmount(one(value) ?? '')
  return parsed && !parsed.startsWith('-') ? parsed : null
}

/** Reads what to show from the address, ignoring anything that doesn't make sense. */
export function viewFromQuery(query: LocationQuery): TransactionView {
  const categories = list(query.category)
  const start = one(query.from)
  const end = one(query.to)
  const custom = [start, end].some((day) => day !== null && ISO_DATE.test(day))
  const periodKeys = periods.map((period) => period.value)
  return {
    filters: {
      q: one(query.q)?.trim().slice(0, 100) ?? '',
      accounts: list(query.account),
      categories: categories.filter((id) => id !== 'none'),
      uncategorized: categories.includes('none'),
      period: custom ? 'custom' : (pick(query.period, periodKeys) ?? 'all'),
      start: custom && start && ISO_DATE.test(start) ? start : null,
      end: custom && end && ISO_DATE.test(end) ? end : null,
      direction: pick(query.direction, ['in', 'out'] as const),
      status: pick(query.status, ['pending', 'posted'] as const),
      sources: list(query.source).filter((source): source is TransactionSource =>
        SOURCES.has(source as TransactionSource),
      ),
      min: amount(query.min),
      max: amount(query.max),
    },
    sort: pick(query.sort, SORTS) ?? '-date',
    page: whole(query.page, 1, 1_000_000),
    pageSize: PAGE_SIZES.find((size) => size === whole(query.size, 50, 200)) ?? 50,
  }
}

/** The address for what to show, leaving out anything at its default. */
export function queryFromView({
  filters,
  sort,
  page,
  pageSize,
}: TransactionView): LocationQueryRaw {
  const query: LocationQueryRaw = {}
  const set = (key: string, value: string | string[] | null, skip: unknown = null) => {
    if (value !== skip && value !== '' && !(Array.isArray(value) && value.length === 0)) {
      query[key] = value
    }
  }
  set('q', filters.q.trim())
  set('account', filters.accounts)
  set('category', filters.uncategorized ? [...filters.categories, 'none'] : filters.categories)
  if (filters.period === 'custom') {
    set('from', filters.start)
    set('to', filters.end)
  } else {
    set('period', filters.period, 'all')
  }
  set('direction', filters.direction)
  set('status', filters.status)
  set('source', filters.sources)
  set('min', filters.min)
  set('max', filters.max)
  set('sort', sort, '-date')
  set('page', String(page), '1')
  set('size', String(pageSize), '50')
  return query
}

/** What to ask the API for. */
export function apiQuery(
  { filters, sort, page, pageSize }: TransactionView,
  now = new Date(),
): TransactionQuery {
  const range =
    filters.period === 'custom'
      ? { start: filters.start ?? undefined, end: filters.end ?? undefined }
      : periodRange(filters.period, now)
  // Amounts in the wrong order still mean between them.
  const [min, max] =
    filters.min && filters.max && Number(filters.min) > Number(filters.max)
      ? [filters.max, filters.min]
      : [filters.min, filters.max]
  return {
    page,
    page_size: pageSize,
    q: filters.q.trim() || undefined,
    account_id: filters.accounts,
    category_id: filters.categories,
    uncategorized: filters.uncategorized || undefined,
    ...range,
    direction: filters.direction ?? undefined,
    status: filters.status ?? undefined,
    source: filters.sources,
    min_amount: min ?? undefined,
    max_amount: max ?? undefined,
    sort,
  }
}

/** How many filters beyond the search and the period are narrowing the list. */
export function filterCount(filters: TransactionFilters): number {
  return (
    filters.accounts.length +
    filters.categories.length +
    Number(filters.uncategorized) +
    Number(filters.period === 'custom') +
    Number(filters.direction !== null) +
    Number(filters.status !== null) +
    filters.sources.length +
    Number(filters.min !== null || filters.max !== null)
  )
}

/** Whether anything at all narrows the list, the search and period included. */
export function isFiltered(filters: TransactionFilters): boolean {
  return filterCount(filters) > 0 || filters.q.trim() !== '' || filters.period !== 'all'
}

/** The tab's view, read from and written to the address. */
export function useTransactionView() {
  const route = useRoute()
  const router = useRouter()
  const view = computed(() => viewFromQuery(route.query))

  /** Changes what's shown. Anything but a new page starts from the first page again. */
  function update(changes: Partial<TransactionView>) {
    const next = { ...view.value, page: 1, ...changes }
    void router.replace({ query: queryFromView(next) })
  }

  function filter(changes: Partial<TransactionFilters>) {
    update({ filters: { ...view.value.filters, ...changes } })
  }

  function clear() {
    update({ filters: emptyFilters() })
  }

  return { view, update, filter, clear }
}
