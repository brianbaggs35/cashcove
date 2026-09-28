import { test as base } from '@playwright/test'

import { ApiClient } from './api'
import { addWebCoverage, coverageEnabled } from './coverage'
import {
  emailOf,
  Harness,
  startSession,
  type BaselineData,
  type SessionState,
  type Who,
} from './harness'
import { AccountsPage } from './pages/accounts-page'
import { AppShell } from './pages/app-shell'
import { CategoriesPage } from './pages/categories-page'
import { ConnectPage } from './pages/connect-page'
import { SignInPage } from './pages/sign-in-page'
import { TransactionsPage } from './pages/transactions-page'
import { PlaidStandIn, useLinkStandIn } from './plaid'

/** The baseline data, and ways to put the database back to it. */
export interface Baseline extends BaselineData {
  /** Replaces everything in the database with the baseline. Call it in a before block. */
  reset(): Promise<void>
  /** Empties the database as on a first start, and returns the setup wizard's one-time code. */
  freshInstall(): Promise<string>
}

export interface CashcoveFixtures {
  /**
   * Signs this test's browser in, skipping the sign-in form, two-step and rate limits. Sign
   * in before opening a page, since the app reads the session when it loads.
   */
  signInAs: (who: Who, options?: { remember?: boolean }) => Promise<SessionState>
  /** An API client signed in as someone, for setting up what a test needs. */
  apiAs: (who: Who) => Promise<ApiClient>
  /** The signed-in app's navigation, account menu and theme switcher. */
  shell: AppShell
  signInPage: SignInPage
  accountsPage: AccountsPage
  transactionsPage: TransactionsPage
  /** Settings > Categories. */
  categoriesPage: CategoriesPage
  /** The Connect tab and its wizard. */
  connectPage: ConnectPage
  /** Plaid Link's window, which a stand-in replaces in every test, and the banks behind the
   * test server's stand-in for Plaid. */
  plaid: PlaidStandIn
  /** Collects the web app's coverage in Chromium, for every test. */
  webCoverage: undefined
}

export interface CashcoveWorkerFixtures {
  harness: Harness
  baseline: Baseline
}

export const test = base.extend<CashcoveFixtures, CashcoveWorkerFixtures>({
  harness: [
    async ({ playwright }, use, workerInfo) => {
      const { baseURL } = workerInfo.project.use
      if (!baseURL) throw new Error('playwright.config.ts needs a baseURL')
      const harness = await Harness.connect(baseURL, playwright.request)
      await use(harness)
      await harness.dispose()
    },
    { scope: 'worker' },
  ],

  baseline: [
    async ({ harness }, use) => {
      const data = await harness.describe()
      await use({
        ...data,
        reset: async () => {
          await harness.reset()
        },
        freshInstall: () => harness.freshInstall(),
      })
    },
    { scope: 'worker' },
  ],

  // Every test's browser gets the stand-in for Plaid Link, so nothing reaches Plaid.
  context: async ({ context }, use) => {
    await useLinkStandIn(context)
    await use(context)
  },

  signInAs: async ({ context, baseline }, use) => {
    await use((who, options) => startSession(context.request, emailOf(baseline, who), options))
  },

  apiAs: async ({ playwright, baseURL, baseline }, use) => {
    const opened: { dispose: () => Promise<void> }[] = []
    await use(async (who) => {
      const request = await playwright.request.newContext({ baseURL, ignoreHTTPSErrors: true })
      opened.push(request)
      const state = await startSession(request, emailOf(baseline, who))
      if (!state.session) throw new Error(`No session came back for ${emailOf(baseline, who)}`)
      return new ApiClient(request, state.session.csrf_token)
    })
    await Promise.all(opened.map((request) => request.dispose()))
  },

  shell: async ({ page }, use) => {
    await use(new AppShell(page))
  },

  signInPage: async ({ page }, use) => {
    await use(new SignInPage(page))
  },

  accountsPage: async ({ page }, use) => {
    await use(new AccountsPage(page))
  },

  transactionsPage: async ({ page }, use) => {
    await use(new TransactionsPage(page))
  },

  categoriesPage: async ({ page }, use) => {
    await use(new CategoriesPage(page))
  },

  connectPage: async ({ page }, use) => {
    await use(new ConnectPage(page))
  },

  plaid: async ({ page, harness }, use) => {
    await use(new PlaidStandIn(page, harness))
  },

  webCoverage: [
    async ({ page, browserName }, use) => {
      // Chromium is the only browser that reports coverage.
      const collect = browserName === 'chromium' && coverageEnabled()
      if (collect) await page.coverage.startJSCoverage({ resetOnNavigation: false })
      await use(undefined)
      if (collect) await addWebCoverage(await page.coverage.stopJSCoverage())
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'
