import type { AiModel, AiProviderKey, AiReview, Confidence, ReviewStatus } from '@/api/ai'

const MILLION = 1_000_000

/**
 * What an AI call or a month of them cost, from millionths of a US dollar. Providers bill in
 * dollars, whatever currency the household uses, so it says so where the locale would.
 */
export function formatCost(micros: number, locale = 'en-US'): string {
  const dollars = micros / MILLION
  // Most calls cost a fraction of a cent, which "$0.00" would hide.
  if (micros > 0 && dollars < 0.0001) return `<${formatCost(100, locale)}`
  // Cents are enough for a dollar or more, and a cent's fractions matter below that.
  const digits = dollars >= 1 || dollars === 0 ? 2 : dollars >= 0.01 ? 3 : 4
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: digits,
  }).format(dollars)
}

/** What a million tokens cost, as a provider's price list gives it: "$2.00" or "$0.015". */
export function formatPrice(dollars: string, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Number(dollars))
}

/** A number of tokens, short: 950, 42K, 1.5M. */
export function formatTokens(tokens: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    tokens,
  )
}

/** What a model costs for a million tokens in and out, or nothing when its price isn't known. */
export function priceLine(model: AiModel, locale = 'en-US'): string | null {
  if (model.input_price === null || model.output_price === null) return null
  return `${formatPrice(model.input_price, locale)} in · ${formatPrice(model.output_price, locale)} out per million tokens`
}

/** Where each provider's own price list is. Ollama on your own computer has none: it's free. */
export const PRICING_PAGES: Record<Exclude<AiProviderKey, 'ollama_local'>, string> = {
  ollama_cloud: 'https://ollama.com/pricing',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  openai: 'https://developers.openai.com/api/docs/pricing',
}

export const confidenceLabels: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
}

export const confidenceColors: Record<Confidence, string> = {
  high: 'success',
  medium: 'info',
  low: 'warning',
}

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: 'Waiting to start',
  running: 'Reviewing',
  done: 'Finished',
  failed: 'Stopped',
}

/** A review that is still going. */
export const reviewActive = (status: ReviewStatus): boolean =>
  status === 'pending' || status === 'running'

/** How many suggestions a review made, whatever has become of them since. */
export const suggestionsOf = (review: AiReview): number =>
  review.open + review.applied + review.dismissed
