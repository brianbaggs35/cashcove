import type { PaymentFrequency, Subscription } from '@/api/subscriptions'
import { addDays, addMonths, todayIso } from '@/utils/dates'
import { fromCents, toCents } from '@/utils/money'

const titles: Record<PaymentFrequency, string> = {
  weekly: 'Weekly',
  biweekly: 'Every two weeks',
  monthly: 'Monthly',
  bimonthly: 'Every two months',
  quarterly: 'Every three months',
  semiannual: 'Every six months',
  annual: 'Annually',
}

export const frequencies = (Object.keys(titles) as PaymentFrequency[]).map((value) => ({
  value,
  title: titles[value],
}))

/** How often a payment repeats, in words, e.g. "Every two weeks". */
export const frequencyTitle = (frequency: PaymentFrequency): string => titles[frequency]

const periodsPerYear: Record<PaymentFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  bimonthly: 6,
  quarterly: 4,
  semiannual: 2,
  annual: 1,
}

/** A rounded estimate, in cents, for comparing recurring costs across frequencies. */
export function estimatedAmount(
  amount: string,
  frequency: PaymentFrequency,
  period: 'month' | 'year',
): string {
  const yearlyAmount = toCents(amount) * periodsPerYear[frequency]
  return fromCents(period === 'month' ? Math.round(yearlyAmount / 12) : yearlyAmount)
}

/** What to expect its next payment to be: the amount it was set up with, or for a bill that changes every time, what recent payments averaged. */
export function expectedAmount(
  subscription: Pick<Subscription, 'amount' | 'expected_amount'>,
): string {
  return subscription.expected_amount ?? subscription.amount
}

/** How many days from today a day is, which is negative once it has gone by. */
export function daysUntil(date: string, today = todayIso()): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  )
}

/**
 * What the last payment was, when it isn't what the subscription says, such as after a price
 * rise. A bill that changes every time has no such thing.
 */
export function priceChange(
  subscription: Pick<Subscription, 'amount' | 'amount_varies' | 'last_payment_amount'>,
): string | null {
  const { amount_varies: varies, last_payment_amount: last, amount } = subscription
  return !varies && last !== null && toCents(last) !== toCents(amount) ? last : null
}

/**
 * Where a subscription stands: being tracked, paused, or cancelled. One that has ended counts as
 * cancelled too, since either way it has stopped. Pausing says nothing about carrying on, so a
 * paused one that has ended is cancelled.
 */
export type Standing = 'active' | 'paused' | 'cancelled'

/** Whether the day it ends has come. Nothing else ends it, so it is always read against today. */
export function hasEnded(subscription: Pick<Subscription, 'ends_on'>, today = todayIso()): boolean {
  return subscription.ends_on !== null && subscription.ends_on <= today
}

export function standing(
  subscription: Pick<Subscription, 'active' | 'ends_on' | 'cancelled_on'>,
  today = todayIso(),
): Standing {
  if (subscription.cancelled_on !== null || hasEnded(subscription, today)) return 'cancelled'
  return subscription.active ? 'active' : 'paused'
}

/**
 * Whether a payment is still expected on its next due date: it doesn't end before then. No payment
 * is expected on the day it ends, or after it.
 */
export function paysAgain(subscription: Pick<Subscription, 'next_due_date' | 'ends_on'>): boolean {
  return subscription.ends_on === null || subscription.next_due_date < subscription.ends_on
}

/**
 * Whether a card or a figure should talk of its next payment: it hasn't stopped, and it doesn't
 * end before then. One that has stopped, cancelled or ended, talks of when it ends instead, and
 * never warns of a payment, though one that is due before it ends is still on the schedule.
 */
export function expectsPayment(
  subscription: Pick<Subscription, 'active' | 'next_due_date' | 'ends_on' | 'cancelled_on'>,
  today = todayIso(),
): boolean {
  return standing(subscription, today) !== 'cancelled' && paysAgain(subscription)
}

/** How many days apart payments are, for the frequencies that repeat by the day. */
const DAYS_BETWEEN: Partial<Record<PaymentFrequency, number>> = { weekly: 7, biweekly: 14 }
/** How many months apart payments are, for the frequencies that repeat by the month. */
const MONTHS_BETWEEN: Partial<Record<PaymentFrequency, number>> = {
  monthly: 1,
  bimonthly: 2,
  quarterly: 3,
  semiannual: 6,
  annual: 12,
}

/**
 * The first day a payment falls due that isn't before today, counted on from its next due date by
 * how often it repeats, the way the API counts. One picked up again after a long time comes back
 * on its old schedule, and not already late.
 */
export function nextOnSchedule(
  subscription: Pick<Subscription, 'next_due_date' | 'frequency'>,
  today = todayIso(),
): string {
  const { next_due_date: due, frequency } = subscription
  const days = DAYS_BETWEEN[frequency]
  if (days !== undefined) {
    return addDays(due, Math.max(0, Math.ceil(daysUntil(today, due) / days)) * days)
  }
  // Counted from the due date each time, so a short month doesn't move the day for good.
  const months = MONTHS_BETWEEN[frequency] as number
  let cycles = 0
  while (addMonths(due, months * cycles) < today) cycles++
  return addMonths(due, months * cycles)
}

/** What it costs in a month and in a year, going by what its next payment is expected to be. */
export function costs(
  subscription: Pick<Subscription, 'amount' | 'expected_amount' | 'frequency'>,
): { month: string; year: string } {
  const amount = expectedAmount(subscription)
  return {
    month: estimatedAmount(amount, subscription.frequency, 'month'),
    year: estimatedAmount(amount, subscription.frequency, 'year'),
  }
}

/** The first and last day the API takes for a day a person chooses, so it can't be sent one it would refuse. */
export const FIRST_DAY = '1970-01-01'
export const LAST_DAY = '2199-12-31'
