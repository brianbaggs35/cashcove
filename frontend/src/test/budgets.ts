import type {
  Budget,
  BudgetPeriodView,
  BudgetSource,
  BudgetTransaction,
  HistoryPeriod,
} from '@/api/budget'

export function makeBudget(changes: Partial<Budget> = {}): Budget {
  return {
    id: 'budget-monthly',
    name: 'Household',
    period: 'monthly',
    starts_on: '2026-09-01',
    amount: '2000.00',
    current: {
      start: '2026-09-01',
      end: '2026-09-30',
      amount: '2000.00',
      income: '2400.00',
      spent: '1250.00',
    },
    created_at: '2026-08-01T12:00:00Z',
    updated_at: '2026-08-01T12:00:00Z',
    ...changes,
  }
}

export function makeSource(changes: Partial<BudgetSource> = {}): BudgetSource {
  return {
    id: 'source-groceries',
    kind: 'spending',
    type: 'category',
    target_id: 'category-groceries',
    name: 'Groceries',
    active: true,
    amount: '124.12',
    count: 2,
    ...changes,
  }
}

/** September 2026, twenty days in, with most of the budget still left. */
export function makePeriod(changes: Partial<BudgetPeriodView> = {}): BudgetPeriodView {
  return {
    budget: makeBudget(),
    start: '2026-09-01',
    end: '2026-09-30',
    previous: '2026-08-01',
    next: null,
    current: true,
    days: 30,
    days_gone: 20,
    amount: '2000.00',
    income: '2400.00',
    spent: '1250.00',
    left: '750.00',
    saved: '1150.00',
    expected: '1333.33',
    projected: '1875.00',
    transactions: 3,
    removed: 0,
    daily: [
      { day: '2026-09-01', income: '0.00', spent: '1000.00' },
      { day: '2026-09-03', income: '0.00', spent: '84.12' },
      { day: '2026-09-15', income: '2400.00', spent: '0.00' },
      { day: '2026-09-18', income: '0.00', spent: '165.88' },
    ],
    categories: [
      { category_id: 'category-coffee', amount: '1000.00', count: 1 },
      { category_id: 'category-groceries', amount: '250.00', count: 2 },
    ],
    sources: [
      makeSource({
        id: 'source-paycheck',
        kind: 'income',
        name: 'Paycheck',
        target_id: 'category-paycheck',
        amount: '2400.00',
        count: 1,
      }),
      makeSource(),
    ],
    upcoming: [],
    converted: [],
    unavailable: [],
    ...changes,
  }
}

export function makeHistory(): HistoryPeriod[] {
  return [
    {
      start: '2026-07-01',
      end: '2026-07-31',
      amount: '2000.00',
      income: '2400.00',
      spent: '1800.00',
      current: false,
    },
    {
      start: '2026-08-01',
      end: '2026-08-31',
      amount: '2000.00',
      income: '2400.00',
      spent: '2150.00',
      current: false,
    },
    {
      start: '2026-09-01',
      end: '2026-09-30',
      amount: '2000.00',
      income: '2400.00',
      spent: '1250.00',
      current: true,
    },
  ]
}

export function makeBudgetTransaction(changes: Partial<BudgetTransaction> = {}): BudgetTransaction {
  return {
    id: 'transaction-groceries',
    date: '2026-09-03',
    payee: 'Whole Foods',
    amount: '-84.12',
    account_id: 'account-checking',
    category_id: 'category-groceries',
    kind: 'spending',
    via: 'category',
    source_id: 'source-groceries',
    ...changes,
  }
}
