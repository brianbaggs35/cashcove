import type { Page } from '@playwright/test'

import type { ApiClient } from './api'
import { dateOf, type BaselineData } from './harness'

/** Where an AI runs: the four providers Settings > AI offers. */
export type AiProviderKey = 'ollama_local' | 'ollama_cloud' | 'anthropic' | 'openai'

/**
 * The made-up keys the test server's stand-in for each provider accepts. The stand-in answers
 * for Anthropic, OpenAI and Ollama's cloud itself, so nothing here reaches a real provider.
 */
export const AI_KEYS = {
  anthropic: 'e2e-anthropic-key',
  openai: 'e2e-openai-key',
  ollama_cloud: 'e2e-ollama-cloud-key',
} as const

/** Where the stand-in for Ollama is on the household's computer, as the container sees it. */
export const OLLAMA_ADDRESS = 'http://host.docker.internal:11434'
/** An Ollama server that can't be reached. */
export const OLLAMA_DOWN_ADDRESS = 'http://ollama-down.example.test:11434'

/** The models the stand-in's Ollama has on the household's computer that can chat. */
export const OLLAMA_MODELS = ['llama3.2:3b', 'qwen3:8b'] as const

/** A request a provider received from Cashcove, as the stand-in kept it. */
export interface AiRequest {
  provider: AiProviderKey
  method: string
  host: string
  path: string
  /** Whether it came with the right key, where the provider asks for one. */
  authorized: boolean
  /** The body, exactly as it was sent. */
  body: string
}

const SETTINGS: Record<
  AiProviderKey,
  { model: string; base_url: string | null; api_key: string | null }
> = {
  openai: { model: 'gpt-6-luna', base_url: null, api_key: AI_KEYS.openai },
  anthropic: { model: 'claude-haiku-4-5-20251001', base_url: null, api_key: AI_KEYS.anthropic },
  ollama_cloud: { model: 'gemma4:31b', base_url: null, api_key: AI_KEYS.ollama_cloud },
  ollama_local: { model: 'llama3.2:3b', base_url: OLLAMA_ADDRESS, api_key: null },
}

/**
 * Sets AI up through the API, as an admin would in Settings > AI, so a test can start from
 * there. A statement file's second opinion is on unless `reviewImports` says otherwise.
 */
export async function setUpAi(
  api: ApiClient,
  provider: AiProviderKey = 'openai',
  { reviewImports = true }: { reviewImports?: boolean } = {},
): Promise<void> {
  await api.put('/ai/settings', { provider, ...SETTINGS[provider], review_imports: reviewImports })
}

/**
 * Holds the AI's answer to a question (`chat`), or its reading of a PDF statement (`statements`),
 * until `release()` is called, so a test can look at what the page says while the AI works,
 * which is over in a moment otherwise.
 */
export async function holdAi(
  page: Page,
  what: 'chat' | 'statements',
): Promise<{ release: () => void }> {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`**/api/ai/${what}`, async (route) => {
    await held
    await route.continue()
  })
  return { release }
}

/** A payment someone enters by hand, with no category, which the AI may have a view on. */
export async function addPayment(
  api: ApiClient,
  baseline: BaselineData,
  payee: string,
  { amount = '-12.00', daysAgo = 0 }: { amount?: string; daysAgo?: number } = {},
): Promise<{ id: string; category_id: string | null }> {
  return api.post('/transactions', {
    account_id: baseline.accounts.checking.id,
    date: dateOf({ days_ago: daysAgo }),
    amount,
    payee,
    category_id: null,
    notes: null,
  })
}
