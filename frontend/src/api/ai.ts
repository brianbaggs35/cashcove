import { apiDelete, apiGet, apiPost, apiPut } from '@/api/client'
import type { ImportFile } from '@/api/imports'

/** Where the household's AI runs. */
export type AiProviderKey = 'ollama_local' | 'ollama_cloud' | 'anthropic' | 'openai'

/** What a request to the AI was for. */
export type AiPurpose = 'chat' | 'review' | 'test' | 'statement'

/** One model someone can pick. */
export interface AiModel {
  id: string
  name: string
  /** A line of advice shown beside it, e.g. when the provider is shutting it down. */
  note: string | null
  deprecated: boolean
  /** What a million tokens in and out cost in US dollars, where the provider's price list has it. */
  input_price: string | null
  output_price: string | null
}

/** A provider that can be chosen, and what it needs. */
export interface AiProvider {
  key: AiProviderKey
  name: string
  summary: string
  needs_key: boolean
  needs_url: boolean
  /** Where Ollama usually is, to start from. */
  default_url: string | null
  /** Where to make a key. */
  key_url: string | null
  docs_url: string
  default_model: string | null
  /** The models to choose from; none for Ollama, whose models are fetched from the server. */
  models: AiModel[]
}

/** How AI is set up. The key is never sent back, only whether one is saved. */
export interface AiSettings {
  configured: boolean
  provider: AiProviderKey | null
  model: string | null
  base_url: string | null
  api_key_set: boolean
  review_imports: boolean
}

/** What to save: leave `api_key` null to keep the one saved for the same provider. */
export interface AiSettingsInput {
  provider: AiProviderKey
  model: string
  base_url: string | null
  api_key: string | null
  review_imports: boolean
}

/** Settings as they are in the form, to fetch models with or try out before saving. */
export interface AiConnectionInput {
  provider: AiProviderKey
  base_url: string | null
  api_key: string | null
  model: string | null
}

/** Whether a provider answered, or what to fix. */
export interface AiTestResult {
  ok: boolean
  message: string
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/** The biggest PDF the API reads. */
export const MAX_STATEMENT_BYTES = 10 * 1024 * 1024

/** One transaction as the AI read it off a statement, which may need checking. */
export interface StatementRow {
  /** Its number among the rows, counted from 1. */
  line: number
  date: string | null
  payee: string
  /** Positive for money in, negative for money out. */
  amount: string | null
  /** Why it should be checked, in words for people. */
  note: string | null
}

/** What the AI read off a PDF statement. Nothing is added until it's checked and imported. */
export interface StatementReading {
  file_name: string
  rows: StatementRow[]
  /** The account the statement seems to be for, worked out on the server from the last digits
   * and the bank it shows: none of that was sent to the AI. */
  account_id: string | null
  /** Lines that looked like transactions but weren't. */
  skipped: number
}

export type ReviewSource = 'manual' | 'import'
export type ReviewStatus = 'pending' | 'running' | 'done' | 'failed'
export type RecommendationStatus = 'open' | 'applied' | 'dismissed'
export type Confidence = 'high' | 'medium' | 'low'

/** One pass of the AI over transactions, to second-guess how they were sorted. */
export interface AiReview {
  id: string
  source: ReviewSource
  status: ReviewStatus
  import_id: string | null
  /** The file an import review looked at, while that import still exists. */
  file_name: string | null
  provider: AiProviderKey
  model: string
  /** How many transactions it set out to look at, and how many it has. */
  total: number
  reviewed: number
  error: string | null
  /** What it found, and what has become of it. */
  open: number
  applied: number
  dismissed: number
  created_by: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}

/** Which transactions a review looks at: the ones nobody chose a category for. */
export interface AiReviewInput {
  scope: 'uncategorized' | 'recent'
  days: number
  limit: number
  today: string
}

/** A category the AI would give a transaction instead of the one it has. */
export interface AiRecommendation {
  id: string
  review_id: string
  transaction_id: string
  date: string
  payee: string
  amount: string
  currency: string
  current_category_id: string | null
  suggested_category_id: string
  confidence: Confidence
  reason: string
  status: RecommendationStatus
  created_at: string
}

export interface RecommendationCounts {
  open: number
  applied: number
  dismissed: number
}

export interface RecommendationPage {
  items: AiRecommendation[]
  total: number
  page: number
  page_size: number
  counts: RecommendationCounts
}

export interface RecommendationQuery {
  status?: RecommendationStatus
  review_id?: string
  page?: number
  page_size?: number
}

/** How many suggestions changed, and how many were left because the transaction had moved on. */
export interface RecommendationResult {
  changed: number
  skipped: number
}

export interface UsageTotals {
  calls: number
  input_tokens: number
  output_tokens: number
  /** In millionths of a US dollar, at the provider's list price. */
  cost_micros: number
}

export interface UsageDay {
  day: string
  calls: number
  tokens: number
  cost_micros: number
}

/** The usage of one model, or for one purpose. */
export interface UsageGroup {
  key: string
  label: string
  provider: AiProviderKey | null
  purpose: AiPurpose | null
  calls: number
  input_tokens: number
  output_tokens: number
  cost_micros: number
}

/** What the AI has been used for and what it cost, in UTC days. */
export interface AiUsage {
  first_day: string
  last_day: string
  totals: UsageTotals
  /** The month so far, whatever range is shown. */
  this_month: UsageTotals
  days: UsageDay[]
  models: UsageGroup[]
  purposes: UsageGroup[]
  /** Calls with no known cost, because the provider's price list doesn't have the model. */
  unpriced_calls: number
}

export const fetchAiProviders = () => apiGet<AiProvider[]>('/ai/providers')
export const fetchAiSettings = () => apiGet<AiSettings>('/ai/settings')
export const saveAiSettings = (input: AiSettingsInput) => apiPut<AiSettings>('/ai/settings', input)
/** Turns AI off and forgets the key. */
export const removeAiSettings = () => apiDelete('/ai/settings')
export const fetchAiModels = (input: AiConnectionInput) =>
  apiPost<{ models: AiModel[] }>('/ai/models', input)
export const testAiConnection = (input: AiConnectionInput) =>
  apiPost<AiTestResult>('/ai/test', input)
/** The reply to the last turn, which has to be a question. `today` is where the person is. */
export const askAi = (messages: ChatTurn[], today: string) =>
  apiPost<{ reply: string }>('/ai/chat', { messages, today })

/** Reads a PDF statement for its transactions. The PDF is read on the server, and the AI only
 * gets the lines that are transactions, with nothing in them that names an account or a person. */
export const readStatementWithAi = (file: ImportFile) =>
  apiPost<StatementReading>('/ai/statements', file)

/** Starts a review, which carries on after this answers: read it again to see how it's going. */
export const startAiReview = (input: AiReviewInput) => apiPost<AiReview>('/ai/reviews', input)
export const fetchAiReviews = () => apiGet<AiReview[]>('/ai/reviews')
export const fetchAiReview = (id: string) => apiGet<AiReview>(`/ai/reviews/${id}`)

export function fetchRecommendations(query: RecommendationQuery = {}) {
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(query)) params.set(name, String(value))
  const text = params.toString()
  const search = text ? `?${text}` : ''
  return apiGet<RecommendationPage>(`/ai/recommendations${search}`)
}
export const applyRecommendations = (ids: string[]) =>
  apiPost<RecommendationResult>('/ai/recommendations/apply', { ids })
export const dismissRecommendations = (ids: string[]) =>
  apiPost<RecommendationResult>('/ai/recommendations/dismiss', { ids })

/** The latest `days` days up to today, which the server counts in UTC. */
export const fetchAiUsage = (days: number) => apiGet<AiUsage>(`/ai/usage?days=${days}`)
