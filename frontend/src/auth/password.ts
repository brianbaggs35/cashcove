import type { ZxcvbnFactory } from '@zxcvbn-ts/core'

export const MIN_LENGTH = 12
export const MAX_LENGTH = 256

export interface PasswordContext {
  email?: string
  name?: string
}

/** Code points, as the API counts them, rather than UTF-16 units. */
function length(value: string): number {
  return Array.from(value).length
}

/**
 * The rules the API applies to new passwords (NIST SP 800-63B), checked here too so people
 * hear about a problem while typing. The API also rejects passwords on its list of common ones.
 */
export function passwordProblem(password: string, context: PasswordContext = {}): string | null {
  const normalized = password.normalize('NFKC')
  if (length(normalized) < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters.`
  if (length(normalized) > MAX_LENGTH) return `Use at most ${MAX_LENGTH} characters.`
  const lowered = normalized.toLowerCase()
  if (new Set(lowered).size < 4) return 'Use more than a few different characters.'
  const words = new Set([
    'cashcove',
    (context.email ?? '').toLowerCase().replace(/@.*/s, ''),
    ...(context.name ?? '').toLowerCase().split(/\s+/),
  ])
  let remainder = lowered
  for (const word of [...words].sort((a, b) => length(b) - length(a))) {
    if (length(word) >= 3) remainder = remainder.replaceAll(word, '')
  }
  if (length(remainder) < 8) {
    return 'Too much of this password is your name, email address or Cashcove.'
  }
  return null
}

export type StrengthScore = 0 | 1 | 2 | 3 | 4

export interface Strength {
  score: StrengthScore
  warning: string | null
  suggestions: string[]
}

let estimator: Promise<ZxcvbnFactory> | null = null

/** The estimator and its word lists are large, so they load the first time they're needed. */
function loadEstimator(): Promise<ZxcvbnFactory> {
  estimator ??= Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
  ]).then(
    ([core, common, english]) =>
      new core.ZxcvbnFactory({
        dictionary: { ...common.dictionary, ...english.dictionary },
        graphs: common.adjacencyGraphs,
        translations: english.translations,
        useLevenshteinDistance: true,
      }),
  )
  return estimator
}

/** How hard a password would be to guess, with advice from zxcvbn. */
export async function estimateStrength(
  password: string,
  context: PasswordContext = {},
): Promise<Strength> {
  const zxcvbn = await loadEstimator()
  const inputs = ['cashcove', context.email ?? '', ...(context.name ?? '').split(/\s+/)]
  const result = zxcvbn.check(
    password,
    inputs.filter((input) => input.length > 0),
  )
  return {
    score: result.score,
    warning: result.feedback.warning,
    suggestions: result.feedback.suggestions,
  }
}
