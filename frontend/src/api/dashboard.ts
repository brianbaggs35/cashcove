import { apiGet } from '@/api/client'
import type { CategoryTotal, DayTotal } from '@/api/budget'

/** What came in and what went out in one calendar month. */
export interface MonthFlow {
  start: string
  end: string
  income: string
  spent: string
}

/** What was spent with one payee. */
export interface PayeeTotal {
  payee: string
  amount: string
  count: number
}

/**
 * How the household is doing this month and over the last few, across every account. Money moving
 * between its own accounts is neither income nor spending, and other currencies are counted in
 * the household's.
 */
export interface Dashboard {
  /** The month the person is in, as far as it has gone. */
  month: MonthFlow
  /** How many days it has, and how many have gone, today's included. */
  days: number
  days_gone: number
  /** The month before, over the same number of days, so the two compare fairly. */
  previous: { income: string; spent: string }
  /** The latest months, the earliest first, ending with this one. */
  months: MonthFlow[]
  /** This month a day at a time: only the days something came in or went out. */
  daily: DayTotal[]
  /** What was spent this month by category, the biggest first, and with the biggest payees. */
  categories: CategoryTotal[]
  payees: PayeeTotal[]
  /** How many transactions, ever, have no category yet. */
  uncategorized: number
  /** How many categories the AI has suggested that nobody has decided on yet. */
  ai_recommendations: number
  /** Currencies that were converted, and ones that couldn't be and so aren't counted. */
  converted: string[]
  unavailable: string[]
}

/** `today` is the date where the person is, which says which month they're in. */
export const fetchDashboard = (today: string) => apiGet<Dashboard>(`/dashboard?today=${today}`)
