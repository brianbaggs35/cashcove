import type { Automation } from '@/api/automations'

export function makeAutomation(changes: Partial<Automation> = {}): Automation {
  return {
    id: 'automation-streaming',
    name: 'Streaming',
    payees: ['Netflix'],
    match: 'exact',
    account_id: null,
    min_amount: null,
    max_amount: null,
    category_id: 'category-groceries',
    subscription_id: null,
    counts: [],
    apply_to: 'all',
    active: true,
    matching_count: 3,
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:00:00Z',
    ...changes,
  }
}
