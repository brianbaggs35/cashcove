import type { PaymentFrequency, Subscription } from '@/api/subscriptions'
import { todayIso } from '@/utils/dates'
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
