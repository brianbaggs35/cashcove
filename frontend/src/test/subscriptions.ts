import type { RecurringOverview, Subscription } from '@/api/subscriptions'

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
    ends_on: null,
    cancelled_on: null,
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

/**
 * One in full, the way its own page gets it: three payments of a monthly subscription that have
 * cost $44.97 so far, with the next two coming and nothing else referring to it.
 */
export function makeOverview(
  subscription: Subscription = makeSubscription(),
  changes: Partial<RecurringOverview> = {},
): RecurringOverview {
  const amount = subscription.amount
  return {
    subscription,
    summary: {
      total: '44.97',
      average: '14.99',
      highest: amount,
      lowest: amount,
      first_on: '2026-07-15',
      this_year: '44.97',
    },
    history: [
      { on: '2026-07-15', amount },
      { on: '2026-08-15', amount },
      { on: '2026-09-15', amount },
    ],
    upcoming: [
      { due_on: '2026-10-15', amount },
      { due_on: '2026-11-15', amount },
    ],
    automations: [],
    budgets: [],
    ...changes,
  }
}
