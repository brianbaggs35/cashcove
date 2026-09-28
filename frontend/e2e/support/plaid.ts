import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'

import type { Harness } from './harness'

/**
 * Plaid in the end-to-end tests. The test server talks to a stand-in for Plaid's API
 * (backend/e2e/plaid.py), and every test's browser gets a stand-in for Plaid Link, the window
 * people sign in to their bank in, so nothing reaches Plaid.
 */

/** Where the web app loads Plaid Link from (src/plaid/link.ts), which the stand-in replaces. */
export const LINK_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

/** The banks the stand-in for Plaid knows, by the key its tokens use. */
const BANKS = {
  platypus: { name: 'First Platypus Bank', institutionId: 'ins_109508' },
  gingham: { name: 'First Gingham Credit Union', institutionId: 'ins_109509' },
  tartan: { name: 'Tartan Bank', institutionId: 'ins_109511' },
  fidelity: { name: 'Fidelity', institutionId: 'ins_12' },
}

/** The banks Link offers to connect: the baseline hasn't connected them yet. Each shares a
 * checking account, a savings account and a credit card, with a couple of months of
 * transactions. */
export const NEW_BANKS = {
  platypus: BANKS.platypus.name,
  gingham: BANKS.gingham.name,
} as const

export type NewBank = keyof typeof NEW_BANKS

type Banks = typeof BANKS

interface StandInOptions {
  token: string
  receivedRedirectUri?: string
  onSuccess: (publicToken: string, metadata: unknown) => void
  onExit: (error: unknown) => void
}

/**
 * Link's stand-in, which runs in the browser in place of Plaid's script. Like Link, it shows a
 * window over the page: a list of banks to connect, or with an update-mode token (the stand-in
 * for Plaid's API marks those), a button to sign in to that bank again. Picking one hands the
 * web app a public token the stand-in for Plaid's API will exchange. With "Sign in on the
 * bank's website" ticked, it leaves for the app's OAuth redirect page instead, as a bank that
 * signs people in on its own website does, and finishes when the app opens it again there.
 */
function standIn(banks: Banks): void {
  let issued = 0

  function create(options: StandInOptions) {
    const updating = /^link-sandbox-update-([a-z]+)-/.exec(options.token)?.[1]
    let panel: HTMLElement | null = null

    function close() {
      panel?.remove()
      panel = null
    }

    function succeed(key: string) {
      close()
      issued += 1
      const bank = banks[key as keyof Banks]
      options.onSuccess(`public-sandbox-${key}-${String(Date.now())}${String(issued)}`, {
        institution: { name: bank.name, institution_id: bank.institutionId },
      })
    }

    function button(label: string, testId: string, onClick: () => void): HTMLButtonElement {
      const element = document.createElement('button')
      element.type = 'button'
      element.textContent = label
      element.dataset.test = testId
      Object.assign(element.style, {
        padding: '10px 14px',
        borderRadius: '8px',
        border: '1px solid #767676',
        background: '#fff',
        color: '#111',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
      })
      element.addEventListener('click', onClick)
      return element
    }

    function open() {
      close()
      const redirect = options.receivedRedirectUri
      if (redirect) {
        // Back from the bank's website: Link picks up where it left off, and finishes.
        const state = new URL(redirect).searchParams.get('oauth_state_id') ?? ''
        setTimeout(() => {
          succeed(updating ?? state.replace(/^e2e-/, ''))
        }, 0)
        return
      }

      panel = document.createElement('div')
      panel.dataset.test = 'plaid-link'
      panel.setAttribute('role', 'dialog')
      panel.setAttribute('aria-modal', 'true')
      panel.setAttribute('aria-labelledby', 'plaid-link-title')
      Object.assign(panel.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.5)',
        fontFamily: 'system-ui, sans-serif',
      })
      const card = document.createElement('div')
      Object.assign(card.style, {
        display: 'grid',
        gap: '12px',
        width: 'min(360px, calc(100% - 32px))',
        padding: '24px',
        borderRadius: '12px',
        background: '#fff',
        color: '#111',
      })
      const title = document.createElement('h2')
      title.id = 'plaid-link-title'
      title.textContent = 'Plaid Link (test stand-in)'
      Object.assign(title.style, { margin: '0', fontSize: '1.25rem' })
      const prompt = document.createElement('p')
      prompt.style.margin = '0'

      const oauth = document.createElement('input')
      oauth.type = 'checkbox'
      oauth.dataset.test = 'plaid-link-oauth'
      const oauthLabel = document.createElement('label')
      Object.assign(oauthLabel.style, { display: 'flex', gap: '8px', alignItems: 'center' })
      oauthLabel.append(oauth, 'Sign in on the bank’s website')

      const choose = (key: string) => {
        if (oauth.checked) {
          window.location.assign(`/connect/oauth?oauth_state_id=e2e-${key}`)
        } else {
          succeed(key)
        }
      }
      const choices: HTMLButtonElement[] = []
      if (updating) {
        prompt.textContent = `Sign in to ${banks[updating as keyof Banks].name} again.`
        choices.push(
          button('Continue', 'plaid-link-continue', () => {
            choose(updating)
          }),
        )
      } else {
        prompt.textContent = 'Choose your bank.'
        for (const key of ['platypus', 'gingham'] as const) {
          choices.push(
            button(banks[key].name, `plaid-link-bank-${key}`, () => {
              choose(key)
            }),
          )
        }
      }
      const fail = button('Fail with an error', 'plaid-link-fail', () => {
        close()
        options.onExit({
          error_type: 'INSTITUTION_ERROR',
          error_code: 'INSTITUTION_NOT_RESPONDING',
          error_message: 'this institution is not currently responding to this request',
          display_message:
            'This financial institution is not currently responding to requests. We apologize for the inconvenience.',
        })
      })
      const exit = button('Close', 'plaid-link-close', () => {
        close()
        options.onExit(null)
      })
      card.append(title, prompt, ...choices, oauthLabel, fail, exit)
      panel.append(card)
      document.body.append(panel)
      choices[0]?.focus()
    }

    return { open, destroy: close }
  }

  Object.assign(window, { Plaid: { create } })
}

/** Serves the stand-in for Link to every page in a browser context, in place of Plaid's. */
export async function useLinkStandIn(context: BrowserContext): Promise<void> {
  const body = `(${standIn.toString()})(${JSON.stringify(BANKS)})`
  await context.route(LINK_SCRIPT, (route) =>
    route.fulfill({ contentType: 'text/javascript', body }),
  )
}

/** A transaction for a bank to report, as Cashcove shows it. */
export interface BankTransaction {
  /** The Cashcove account, which a bank keeps up to date: `baseline.accounts.card.id`. */
  account_id: string
  /** Negative when money leaves the account: `'-12.34'`. */
  amount: string
  payee: string
  /** One of Plaid's categories (`FOOD_AND_DRINK_RESTAURANT`), which Cashcove maps to one of
   * its own. Leave it out for general shopping. */
  category?: string
}

/**
 * Plaid, from a test: Link's window while it's open, and the banks behind the stand-in for
 * Plaid's API.
 */
export class PlaidStandIn {
  /** Link's window, while it's open. */
  readonly link: Locator

  constructor(
    readonly page: Page,
    private readonly harness: Harness,
  ) {
    this.link = page.getByTestId('plaid-link')
  }

  /**
   * Picks a bank in Link, which connects it. With `onBankWebsite`, the bank signs people in on
   * its own website first, so the app goes through its OAuth redirect page.
   */
  async connect(bank: NewBank, { onBankWebsite = false } = {}): Promise<void> {
    await this.choose(`plaid-link-bank-${bank}`, onBankWebsite)
  }

  /** Signs in to a connected bank again, when Link opens to reconnect it or share accounts. */
  async signInAgain({ onBankWebsite = false } = {}): Promise<void> {
    await this.choose('plaid-link-continue', onBankWebsite)
  }

  /** Closes Link without connecting anything. */
  async close(): Promise<void> {
    await this.link.getByTestId('plaid-link-close').click()
    await expect(this.link).toBeHidden()
  }

  /** Closes Link with an error, as when the bank isn't responding. */
  async fail(): Promise<void> {
    await this.link.getByTestId('plaid-link-fail').click()
    await expect(this.link).toBeHidden()
  }

  /** Has a bank report a new transaction, which its next sync brings in. */
  async addTransaction(transaction: BankTransaction): Promise<void> {
    await this.harness.addBankTransaction(transaction)
  }

  /**
   * Has a connected bank fail its syncs with one of Plaid's error codes, such as
   * `ITEM_LOGIN_REQUIRED` when it wants someone to sign in again, until it's reconnected or
   * the code is cleared with null.
   */
  async failSyncs(connectionId: string, code: string | null): Promise<void> {
    await this.harness.failBankSyncs(connectionId, code)
  }

  private async choose(testId: string, onBankWebsite: boolean): Promise<void> {
    if (onBankWebsite) await this.link.getByTestId('plaid-link-oauth').check()
    await this.link.getByTestId(testId).click()
    await expect(this.link).toBeHidden()
  }
}
