import type { BudgetPeriodKind } from '@/api/budget'
import { fromIsoDate } from '@/utils/dates'
import { toCents } from '@/utils/money'

export const periodTitles: Record<BudgetPeriodKind, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

/** The same, short enough for a row of buttons. */
export const periodShortTitles: Record<BudgetPeriodKind, string> = {
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
}

/** What each choice of how often a budget repeats means, for under the buttons that choose it. */
export const periodHints: Record<BudgetPeriodKind, string> = {
  weekly: 'Starts over every week, on your first day of the week.',
  biweekly: 'Starts over every two weeks, which suits being paid every other week.',
  monthly: 'Starts over on the 1st of each month.',
  yearly: 'Starts over each year, when your budget year begins.',
}

/** How a budget's amount reads next to it, e.g. "$2,000.00 per month". */
export const perPeriod: Record<BudgetPeriodKind, string> = {
  weekly: 'per week',
  biweekly: 'every two weeks',
  monthly: 'per month',
  yearly: 'per year',
}

/** The words for one period, e.g. "this month", for what the person is in. */
export const thisPeriod: Record<BudgetPeriodKind, string> = {
  weekly: 'this week',
  biweekly: 'these two weeks',
  monthly: 'this month',
  yearly: 'this year',
}

/** The choices of how often a budget repeats, shortest first. */
export const periodOptions = (Object.keys(periodTitles) as BudgetPeriodKind[]).map((value) => ({
  value,
  title: periodShortTitles[value],
}))

const lastDayOf = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()

/**
 * A period in words: "September 2026" for a whole month, "2026" for a whole calendar year, and
 * the days it covers otherwise, e.g. "Sep 20 – 26, 2026".
 */
export function periodLabel(
  period: BudgetPeriodKind,
  start: string,
  end: string,
  locale = 'en-US',
): string {
  const first = fromIsoDate(start)
  const last = fromIsoDate(end)
  const wholeMonth = first.getDate() === 1 && last.getDate() === lastDayOf(last)
  if (period === 'monthly' && wholeMonth && first.getMonth() === last.getMonth()) {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(first)
  }
  if (period === 'yearly') {
    if (first.getMonth() === 0 && wholeMonth && last.getMonth() === 11)
      return String(first.getFullYear())
    return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).formatRange(
      first,
      last,
    )
  }
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).formatRange(first, last)
}

/** A period's name for the axis of a chart, which has little room: "Sep", "Sep 20" or "2026". */
export function shortPeriodLabel(
  period: BudgetPeriodKind,
  start: string,
  locale = 'en-US',
): string {
  const first = fromIsoDate(start)
  if (period === 'yearly') return String(first.getFullYear())
  if (period === 'monthly') return new Intl.DateTimeFormat(locale, { month: 'short' }).format(first)
  return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(first)
}

/** How a budget is doing: over what it has, close to it, or fine. */
export type BudgetStatus = 'over' | 'near' | 'ok'

/** The theme colour a status is shown in. */
export const statusColors: Record<BudgetStatus, string> = {
  over: 'error',
  near: 'warning',
  ok: 'primary',
}

/**
 * Whether spending is over the amount, or at least `threshold` percent of it (from the household's
 * alert settings, which can turn that off with null).
 */
export function budgetStatus(
  spent: string,
  amount: string,
  threshold: number | null,
): BudgetStatus {
  const cents = toCents(spent)
  const limit = toCents(amount)
  if (cents > limit) return 'over'
  return threshold !== null && cents * 100 >= limit * threshold ? 'near' : 'ok'
}

/** How much of the amount has been spent, as a percentage: not held to 100, so overspending shows. */
export function percentSpent(spent: string, amount: string): number {
  const limit = toCents(amount)
  return limit > 0 ? Math.round((toCents(spent) / limit) * 100) : 0
}
