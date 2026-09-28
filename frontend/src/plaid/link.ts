import type { HistoryDays } from '@/api/connections'

/**
 * Plaid Link, the window people sign in to their bank in. Plaid asks that its script always
 * load from its own CDN, never bundled or copied (https://plaid.com/docs/link/web/), so it
 * loads the first time someone connects a bank. The server's Content-Security-Policy allows
 * exactly this script, Link's frame and Plaid's API.
 */
export const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

const LOAD_FAILED =
  "Couldn't load Plaid. Check your connection, and that nothing like an ad blocker is stopping cdn.plaid.com, then try again."

/** Why Link closed without connecting a bank, when something went wrong. */
export interface LinkError {
  error_type: string
  error_code: string
  error_message: string
  /** Plaid's words for people, when it has some. */
  display_message: string | null
}

interface LinkInstitution {
  name: string
  institution_id: string
}

interface LinkSuccessMetadata {
  institution: LinkInstitution | null
}

interface LinkOptions {
  token: string
  /** Set when Link comes back from a bank's own sign-in page (OAuth). */
  receivedRedirectUri?: string
  onSuccess: (publicToken: string, metadata: LinkSuccessMetadata) => void
  onExit: (error: LinkError | null) => void
}

interface LinkHandler {
  open: () => void
  destroy: () => void
}

/** The part of Link's `window.Plaid` Cashcove uses. */
export interface PlaidLink {
  create: (options: LinkOptions) => LinkHandler
}

declare global {
  interface Window {
    Plaid?: PlaidLink
  }
}

/** How Link closed: with a bank connected (or signed in to again), or not. */
export type LinkOutcome =
  | { connected: true; publicToken: string; institution: string | null }
  | { connected: false; error: LinkError | null }

let loading: Promise<PlaidLink> | null = null

/** Loads Link's script, once. */
export function loadLink(): Promise<PlaidLink> {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  loading ??= new Promise<PlaidLink>((resolve, reject) => {
    const script = document.createElement('script')
    const settle = () => {
      loading = null
      if (window.Plaid) {
        resolve(window.Plaid)
        return
      }
      script.remove()
      reject(new Error(LOAD_FAILED))
    }
    script.src = LINK_SCRIPT
    script.async = true
    script.addEventListener('load', settle)
    script.addEventListener('error', settle)
    document.head.append(script)
  })
  return loading
}

/** Opens Link and resolves once the person connects a bank or closes it. */
export async function openLink(token: string, receivedRedirectUri?: string): Promise<LinkOutcome> {
  const plaid = await loadLink()
  return new Promise((resolve) => {
    const finish = (outcome: LinkOutcome) => {
      // Link tidies up after calling back, so its frame goes once the callback returns.
      setTimeout(() => {
        handler.destroy()
      })
      resolve(outcome)
    }
    const handler = plaid.create({
      token,
      ...(receivedRedirectUri ? { receivedRedirectUri } : {}),
      onSuccess: (publicToken, metadata) => {
        finish({ connected: true, publicToken, institution: metadata.institution?.name ?? null })
      },
      onExit: (error) => {
        finish({ connected: false, error })
      },
    })
    handler.open()
  })
}

/** What Link was opened for, so it can pick up where it left off after a bank's own sign-in. */
export type LinkPurpose = 'connect' | 'reconnect' | 'accounts'

export interface PendingLink {
  token: string
  purpose: LinkPurpose
  /** The connection being reconnected, or whose accounts are changing. */
  connectionId: string | null
  historyDays: HistoryDays | null
}

const PENDING = 'cashcove.pendingLink'

/**
 * Some banks sign people in on their own site (OAuth) and send them back to /connect/oauth,
 * which reopens Link with the same token. The token is kept for this tab only, and only until
 * then: link tokens expire within hours and can only start Link.
 */
export function rememberLink(pending: PendingLink): void {
  try {
    sessionStorage.setItem(PENDING, JSON.stringify(pending))
  } catch {
    // Without storage, a bank that signs in on its own site has to be connected again.
  }
}

export function forgetLink(): void {
  try {
    sessionStorage.removeItem(PENDING)
  } catch {
    // Nothing was kept.
  }
}

function isPendingLink(value: unknown): value is PendingLink {
  if (typeof value !== 'object' || value === null) return false
  const pending = value as Record<string, unknown>
  return (
    typeof pending.token === 'string' &&
    ['connect', 'reconnect', 'accounts'].includes(pending.purpose as string) &&
    (pending.connectionId === null || typeof pending.connectionId === 'string')
  )
}

/** The Link that a bank's own sign-in page sent people back to, once. */
export function takePendingLink(): PendingLink | null {
  try {
    const saved = sessionStorage.getItem(PENDING)
    sessionStorage.removeItem(PENDING)
    const pending: unknown = saved ? JSON.parse(saved) : null
    return isPendingLink(pending) ? pending : null
  } catch {
    return null
  }
}

/** What to tell people when Link closed with an error. */
export function linkErrorMessage(error: LinkError): string {
  return (
    error.display_message ??
    `Plaid couldn't connect the bank (${error.error_code}). Try again, or try another bank.`
  )
}
