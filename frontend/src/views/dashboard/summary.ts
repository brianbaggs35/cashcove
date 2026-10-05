import type { CategoryTotal } from '@/api/budget'
import type { RecurringKind, Subscription } from '@/api/subscriptions'
import { fromIsoDate } from '@/utils/dates'
import { formatCount } from '@/utils/format'
import { toCents } from '@/utils/money'
import { expectedAmount } from '@/views/subscriptions/recurrence'

export type Direction = 'up' | 'down' | 'same'

/** How an amount compares with what it was: by how much, in cents, and which way it went. */
export interface Change {
  cents: number
  direction: Direction
}

const DIRECTIONS: Direction[] = ['down', 'same', 'up']

export function changeBetween(current: string, before: string): Change {
  const cents = toCents(current) - toCents(before)
  return { cents: Math.abs(cents), direction: DIRECTIONS[Math.sign(cents) + 1] as Direction }
}

/** Whether a change is good news, or bad, or neither: whether up is good depends on what moved. */
export type Tone = 'good' | 'bad' | 'neutral'

export function toneOf(direction: Direction, upIsGood: boolean): Tone {
  if (direction === 'same') return 'neutral'
  return (direction === 'up') === upIsGood ? 'good' : 'bad'
}

/** How many of the categories spent the most in are shown on their own; the rest are counted together. */
export const SLICES = 5

/** One part of where the money went: a category (or none), or everything past the first few. */
export interface Slice {
  key: string
  /** The category, or null for spending with none and for everything else. */
  categoryId: string | null
  /** Everything past the first few categories. */
  rest: boolean
  cents: number
  count: number
  /** The chart colour it is drawn in, which follows its place in the order. */
  color: string
}

/** The categories spending went to, biggest first, with the tail folded into one slice. */
export function slices(categories: CategoryTotal[]): Slice[] {
  const spent = categories.filter((item) => toCents(item.amount) > 0)
  const shown = spent.slice(0, SLICES).map((item, index): Slice => ({
    key: item.category_id ?? 'none',
    categoryId: item.category_id,
    rest: false,
    cents: toCents(item.amount),
    count: item.count,
    color: `var(--chart-cat-${index + 1})`,
  }))
  const tail = spent.slice(SLICES)
  if (!tail.length) return shown
  return [
    ...shown,
    {
      key: 'rest',
      categoryId: null,
      rest: true,
      cents: tail.reduce((total, item) => total + toCents(item.amount), 0),
      count: tail.reduce((total, item) => total + item.count, 0),
      color: 'var(--chart-other)',
    },
  ]
}

/** A subscription's or a bill's payment that is coming up, or overdue. */
export interface DueItem {
  id: string
  name: string
  kind: RecurringKind
  dueOn: string
  /** What the payment is expected to be. */
  amount: string
  /** How many days from today it is due, which is negative once it's late. */
  days: number
}

/** How many days the dashboard looks ahead for payments. */
export const LOOK_AHEAD = 14

const DAY = 24 * 60 * 60 * 1000

/** The payments being tracked that are overdue or due within `within` days, the soonest first. */
export function dueSoon(recurring: Subscription[], today: string, within = LOOK_AHEAD): DueItem[] {
  const now = fromIsoDate(today).getTime()
  return recurring
    .filter((item) => item.active)
    .map((item): DueItem => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      dueOn: item.next_due_date,
      amount: expectedAmount(item),
      days: Math.round((fromIsoDate(item.next_due_date).getTime() - now) / DAY),
    }))
    .filter((item) => item.days <= within)
    .sort((a, b) => a.days - b.days || a.name.localeCompare(b.name))
}

/** When a payment is due, in words: "Due in 3 days", "Due today" or "Overdue by 2 days". */
export function dueText(days: number): string {
  if (days < 0) return `Overdue by ${formatCount(-days, 'day')}`
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due in ${formatCount(days, 'day')}`
}
