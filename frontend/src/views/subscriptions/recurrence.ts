import type { PaymentFrequency } from '@/api/subscriptions'
import { fromCents, toCents } from '@/utils/money'

export const frequencies: { value: PaymentFrequency; title: string }[] = [
  { value: 'weekly', title: 'Weekly' },
  { value: 'biweekly', title: 'Every two weeks' },
  { value: 'monthly', title: 'Monthly' },
  { value: 'quarterly', title: 'Every three months' },
  { value: 'semiannual', title: 'Every six months' },
  { value: 'annual', title: 'Annually' },
]

const periodsPerYear: Record<PaymentFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
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
