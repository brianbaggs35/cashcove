import type {
  AiModel,
  AiProvider,
  AiRecommendation,
  AiReview,
  AiSettings,
  AiUsage,
  AutomationSuggestion,
  RecommendationPage,
  SearchFilters,
  SearchResult,
  StatementReading,
  StatementRow,
} from '@/api/ai'

export function makeModel(changes: Partial<AiModel> = {}): AiModel {
  return {
    id: 'gpt-6-luna',
    name: 'GPT-6 Luna',
    note: 'The most efficient GPT-6, for focused, high-volume work.',
    deprecated: false,
    input_price: '0.1',
    output_price: '0.5',
    ...changes,
  }
}

/** The four providers, as the API lists them. */
export function makeProviders(): AiProvider[] {
  return [
    {
      key: 'ollama_local',
      name: 'Ollama (on your computer)',
      summary: 'Runs models on your own hardware, so nothing leaves your network.',
      needs_key: false,
      needs_url: true,
      default_url: 'http://host.docker.internal:11434',
      key_url: null,
      docs_url: 'https://docs.ollama.com/api/introduction',
      default_model: null,
      models: [],
    },
    {
      key: 'ollama_cloud',
      name: 'Ollama Cloud',
      summary: 'Ollama’s hosted models, with a key from your Ollama account.',
      needs_key: true,
      needs_url: false,
      default_url: null,
      key_url: 'https://ollama.com/settings/keys',
      docs_url: 'https://docs.ollama.com/cloud',
      default_model: null,
      models: [],
    },
    {
      key: 'anthropic',
      name: 'Anthropic',
      summary: 'Claude, with an API key from the Claude Console.',
      needs_key: true,
      needs_url: false,
      default_url: null,
      key_url: 'https://platform.claude.com/settings/keys',
      docs_url: 'https://platform.claude.com/docs/en/about-claude/models/overview',
      default_model: 'claude-haiku-4-5-20251001',
      models: [
        makeModel({
          id: 'claude-haiku-4-5-20251001',
          name: 'Claude Haiku 4.5',
          note: 'The fastest and cheapest.',
          input_price: '1',
          output_price: '5',
        }),
        makeModel({
          id: 'claude-sonnet-5-5',
          name: 'Claude Sonnet 5.5',
          note: 'The best mix of speed and intelligence.',
          input_price: '2',
          output_price: '10',
        }),
      ],
    },
    {
      key: 'openai',
      name: 'OpenAI',
      summary: 'GPT, with an API key from the OpenAI platform.',
      needs_key: true,
      needs_url: false,
      default_url: null,
      key_url: 'https://platform.openai.com/api-keys',
      docs_url: 'https://developers.openai.com/api/docs/models',
      default_model: 'gpt-6-luna',
      models: [
        makeModel(),
        makeModel({
          id: 'gpt-5.4-nano',
          name: 'GPT-5.4 nano',
          note: 'OpenAI is shutting it down on April 1, 2027. Use GPT-6 Luna instead.',
          deprecated: true,
          input_price: '0.2',
          output_price: '1.25',
        }),
      ],
    },
  ]
}

export function makeAiSettings(changes: Partial<AiSettings> = {}): AiSettings {
  return {
    configured: true,
    provider: 'openai',
    model: 'gpt-6-luna',
    base_url: null,
    api_key_set: true,
    review_imports: true,
    ...changes,
  }
}

export const aiOff: AiSettings = makeAiSettings({
  configured: false,
  provider: null,
  model: null,
  api_key_set: false,
})

export function makeReview(changes: Partial<AiReview> = {}): AiReview {
  return {
    id: 'review-1',
    source: 'manual',
    status: 'done',
    import_id: null,
    file_name: null,
    provider: 'openai',
    model: 'gpt-6-luna',
    total: 12,
    reviewed: 12,
    error: null,
    open: 2,
    applied: 1,
    dismissed: 0,
    created_by: 'Alex Rivera',
    created_at: '2026-09-20T15:00:00Z',
    started_at: '2026-09-20T15:00:01Z',
    finished_at: '2026-09-20T15:00:09Z',
    ...changes,
  }
}

export function makeRecommendation(changes: Partial<AiRecommendation> = {}): AiRecommendation {
  return {
    id: 'recommendation-coffee',
    review_id: 'review-1',
    transaction_id: 'transaction-coffee',
    date: '2026-09-18',
    payee: 'Blue Bottle',
    amount: '-4.50',
    currency: 'USD',
    current_category_id: null,
    suggested_category_id: 'category-coffee',
    confidence: 'high',
    reason: 'A coffee shop.',
    status: 'open',
    created_at: '2026-09-20T15:00:09Z',
    ...changes,
  }
}

export function makeRecommendationPage(
  items: AiRecommendation[] = [makeRecommendation()],
  changes: Partial<RecommendationPage> = {},
): RecommendationPage {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 20,
    counts: { open: items.length, applied: 0, dismissed: 0 },
    ...changes,
  }
}

export function makeUsage(changes: Partial<AiUsage> = {}): AiUsage {
  return {
    first_day: '2026-09-14',
    last_day: '2026-09-20',
    totals: { calls: 7, input_tokens: 42_000, output_tokens: 3_100, cost_micros: 5_750 },
    this_month: { calls: 19, input_tokens: 150_000, output_tokens: 9_000, cost_micros: 19_500 },
    days: [
      { day: '2026-09-14', calls: 0, tokens: 0, cost_micros: 0 },
      { day: '2026-09-15', calls: 2, tokens: 9_000, cost_micros: 1_200 },
      { day: '2026-09-16', calls: 0, tokens: 0, cost_micros: 0 },
      { day: '2026-09-17', calls: 1, tokens: 4_000, cost_micros: 800 },
      { day: '2026-09-18', calls: 3, tokens: 25_000, cost_micros: 3_100 },
      { day: '2026-09-19', calls: 1, tokens: 7_100, cost_micros: 650 },
      { day: '2026-09-20', calls: 0, tokens: 0, cost_micros: 0 },
    ],
    models: [
      {
        key: 'gpt-6-luna',
        label: 'GPT-6 Luna (OpenAI)',
        provider: 'openai',
        purpose: null,
        calls: 6,
        input_tokens: 40_000,
        output_tokens: 3_000,
        cost_micros: 5_500,
      },
      {
        key: 'gemma4:31b',
        label: 'gemma4:31b (Ollama Cloud)',
        provider: 'ollama_cloud',
        purpose: null,
        calls: 1,
        input_tokens: 2_000,
        output_tokens: 100,
        cost_micros: 250,
      },
    ],
    purposes: [
      {
        key: 'chat',
        label: 'Questions in the AI tab',
        provider: null,
        purpose: 'chat',
        calls: 5,
        input_tokens: 30_000,
        output_tokens: 2_100,
        cost_micros: 4_000,
      },
      {
        key: 'review',
        label: 'Second opinions on categories',
        provider: null,
        purpose: 'review',
        calls: 2,
        input_tokens: 12_000,
        output_tokens: 1_000,
        cost_micros: 1_750,
      },
    ],
    unpriced_calls: 0,
    ...changes,
  }
}

/** A transaction as the AI read it off a statement. */
export function makeStatementRow(changes: Partial<StatementRow> = {}): StatementRow {
  return {
    line: 1,
    date: '2026-09-02',
    payee: 'Wholefds Mkt Austin Tx',
    amount: '-84.12',
    note: null,
    ...changes,
  }
}

/** What the AI read off a statement for the checking account: a purchase, a paycheck, and a
 * payment on a date outside the statement's that needs a look. */
export function makeStatementReading(changes: Partial<StatementReading> = {}): StatementReading {
  return {
    file_name: 'september.pdf',
    rows: [
      makeStatementRow(),
      makeStatementRow({
        line: 2,
        date: '2026-09-05',
        payee: 'Acme Corp Payroll',
        amount: '2400.00',
      }),
      makeStatementRow({
        line: 3,
        date: '2026-12-30',
        payee: 'Zelle Payment To',
        amount: '-50.00',
        note: 'The date is outside the statement’s dates.',
      }),
    ],
    account_id: 'account-checking',
    skipped: 1,
    ...changes,
  }
}

/** What the AI made of "groceries over $50 last month": a category, an amount and some days. */
export function makeSearchFilters(changes: Partial<SearchFilters> = {}): SearchFilters {
  return {
    q: '',
    account_ids: [],
    category_ids: ['category-groceries'],
    uncategorized: false,
    start: '2026-08-01',
    end: '2026-08-31',
    direction: 'out',
    status: null,
    sources: [],
    min_amount: '50.00',
    max_amount: null,
    sort: null,
    ...changes,
  }
}

export function makeSearchResult(
  changes: Partial<SearchResult> = {},
  filters: Partial<SearchFilters> = {},
): SearchResult {
  return { filters: makeSearchFilters(filters), ignored: [], ...changes }
}

/** An automation the AI suggests for a payee that groceries were chosen for four times. */
export function makeAutomationSuggestion(
  changes: Partial<AutomationSuggestion> = {},
): AutomationSuggestion {
  return {
    ref: 'g1',
    name: 'Whole Foods',
    payees: ['WHOLEFDS MKT'],
    match: 'starts_with',
    direction: 'out',
    category_id: 'category-groceries',
    apply_to: 'all',
    reason: 'Every one begins with WHOLEFDS MKT.',
    choices: 4,
    last_chosen: '2026-09-18',
    examples: ['WHOLEFDS MKT #10231 AUSTIN TX', 'WHOLEFDS MKT #10232 AUSTIN TX'],
    sorts_now: 2,
    elsewhere: 0,
    overlaps: [],
    ...changes,
  }
}
