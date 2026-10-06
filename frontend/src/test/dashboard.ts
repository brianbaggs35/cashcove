import type { Dashboard, MonthFlow } from '@/api/dashboard'

export function makeMonth(changes: Partial<MonthFlow> = {}): MonthFlow {
  return { start: '2026-09-01', end: '2026-09-30', income: '2400.00', spent: '1250.00', ...changes }
}

/** September 2026, twenty days in: six months of history, spending in three categories and four payees. */
export function makeDashboard(changes: Partial<Dashboard> = {}): Dashboard {
  return {
    month: makeMonth(),
    days: 30,
    days_gone: 20,
    previous: { income: '2300.00', spent: '1400.00' },
    months: [
      makeMonth({ start: '2026-04-01', end: '2026-04-30', income: '2300.00', spent: '1900.00' }),
      makeMonth({ start: '2026-05-01', end: '2026-05-31', income: '2300.00', spent: '2100.00' }),
      makeMonth({ start: '2026-06-01', end: '2026-06-30', income: '2300.00', spent: '2450.00' }),
      makeMonth({ start: '2026-07-01', end: '2026-07-31', income: '2350.00', spent: '1800.00' }),
      makeMonth({ start: '2026-08-01', end: '2026-08-31', income: '2300.00', spent: '2000.00' }),
      makeMonth(),
    ],
    daily: [
      { day: '2026-09-01', income: '0.00', spent: '1000.00' },
      { day: '2026-09-03', income: '0.00', spent: '84.12' },
      { day: '2026-09-15', income: '2400.00', spent: '0.00' },
      { day: '2026-09-18', income: '0.00', spent: '165.88' },
    ],
    categories: [
      { category_id: 'category-groceries', amount: '700.00', count: 6 },
      { category_id: 'category-coffee', amount: '350.00', count: 12 },
      { category_id: null, amount: '200.00', count: 3 },
    ],
    payees: [
      { payee: 'Whole Foods', amount: '420.00', count: 4 },
      { payee: 'Blue Bottle', amount: '105.50', count: 1 },
    ],
    uncategorized: 3,
    ai_recommendations: 0,
    converted: [],
    unavailable: [],
    ...changes,
  }
}
