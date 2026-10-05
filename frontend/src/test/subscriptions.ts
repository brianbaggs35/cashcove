import type { Subscription } from '@/api/subscriptions'

export function makeSubscription(changes: Partial<Subscription> = {}): Subscription {
  const amount = changes.amount ?? '14.99'
  return {
    id: 'subscription-streamflix',
    name: 'Streamflix',
    kind: 'subscription',
    payee: 'Streamflix',
    amount,
    amount_varies: false,
    frequency: 'monthly',
    account_id: 'account-checking',
    next_due_date: '2026-10-15',
    category_id: 'category-groceries',
    notes: null,
    active: true,
    payment_count: 2,
    last_payment_on: '2026-09-15',
    last_payment_amount: amount,
    typical_amount: amount,
    expected_amount: amount,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    ...changes,
  }
}

/** A bill, which is a recurring payment like a subscription: electricity, usually a different amount each month. */
export function makeBill(changes: Partial<Subscription> = {}): Subscription {
  return makeSubscription({
    id: 'bill-power',
    name: 'City Power',
    kind: 'bill',
    payee: 'City Power & Light',
    amount: '96.40',
    amount_varies: true,
    expected_amount: '96.40',
    typical_amount: '96.40',
    last_payment_amount: '96.40',
    ...changes,
  })
}
