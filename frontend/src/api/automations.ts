import type { BudgetKind } from '@/api/budget'
import { apiDelete, apiGet, apiPatch, apiPost } from '@/api/client'

/** Which transactions an automation sorts: those the household has and every later one, or only the later ones. */
export type AutomationScope = 'all' | 'future'

/**
 * How what an automation looks for is compared with a transaction's payee and with what the
 * bank called it: the whole of it, the start of it, or anywhere in it.
 */
export type AutomationMatch = 'exact' | 'starts_with' | 'contains'

/** Which way the money went in the transactions an automation sorts: either, in or out. */
export type AutomationDirection = 'any' | 'in' | 'out'

/** An automation counting what it sorts toward a budget, as income or as spending. */
export interface AutomationCount {
  budget_id: string
  kind: BudgetKind
}

export interface Automation {
  id: string
  name: string
  /** What it looks for: payees, or text from a payee or from what the bank called it. */
  payees: string[]
  match: AutomationMatch
  /** It only sorts money coming in or money going out, or either way. */
  direction: AutomationDirection
  /** It only sorts transactions in this account, or in any account when null. */
  account_id: string | null
  /** It only sorts transactions of this much, whichever way the money went. Either can be null. */
  min_amount: string | null
  max_amount: string | null
  /** The category it gives, and the subscription it links payments to. Either can be null. */
  category_id: string | null
  subscription_id: string | null
  /** The budgets it counts what it sorts toward, which is something it can do on its own. */
  counts: AutomationCount[]
  apply_to: AutomationScope
  active: boolean
  /** How many of the household's transactions it sorts. */
  matching_count: number
  created_at: string
  updated_at: string
}

export interface AutomationInput {
  name: string
  payees: string[]
  match: AutomationMatch
  direction: AutomationDirection
  account_id: string | null
  min_amount: string | null
  max_amount: string | null
  category_id: string | null
  subscription_id: string | null
  counts: AutomationCount[]
  apply_to: AutomationScope
}

export type AutomationChanges = Partial<AutomationInput> & { active?: boolean }

/** What saving an automation did: how many transactions it already had that it sorted. */
export interface AutomationSaved extends Automation {
  applied: number
}

/** Another automation that gives some of the same transactions the same kind of thing. */
export interface OverlappingAutomation {
  automation_id: string
  automation_name: string
  /** How many of the household's transactions both of them sort. */
  count: number
}

/** What an automation like this would sort, before it's saved. */
export interface AutomationPreview {
  matching: number
  overlaps: OverlappingAutomation[]
}

/** What to preview: the same as an automation is made of, and what it would give. */
export interface PreviewRequest {
  payees: string[]
  match: AutomationMatch
  direction: AutomationDirection
  accountId: string | null
  minAmount: string | null
  maxAmount: string | null
  /** The one being changed, which doesn't overlap itself. */
  automationId: string | null
  /** Whether it would give a category, and whether it would link a subscription. */
  category: boolean
  subscription: boolean
}

/** Active automations first, then the newest. */
export const fetchAutomations = () => apiGet<Automation[]>('/automations')
export const createAutomation = (input: AutomationInput) =>
  apiPost<AutomationSaved>('/automations', input)
/** Leave a field out to keep it. Null takes the account, category or subscription away. */
export const updateAutomation = (id: string, changes: AutomationChanges) =>
  apiPatch<AutomationSaved>(`/automations/${id}`, changes)
export const deleteAutomation = (id: string) => apiDelete(`/automations/${id}`)
/** What an automation like this would sort, and which others already sort some of the same. */
export const previewAutomation = (request: PreviewRequest) =>
  apiPost<AutomationPreview>('/automations/preview', {
    payees: request.payees,
    match: request.match,
    direction: request.direction,
    account_id: request.accountId,
    min_amount: request.minAmount,
    max_amount: request.maxAmount,
    automation_id: request.automationId,
    category: request.category,
    subscription: request.subscription,
  })
