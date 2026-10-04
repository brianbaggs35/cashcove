import type { Subscription } from '@/api/subscriptions'

export function makeSubscription(changes: Partial<Subscription> = {}): Subscription {
  const amount = changes.amount ?? '14.99'
  return {
    id: 'subscription-streamflix',
    name: 'Streamflix',
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
