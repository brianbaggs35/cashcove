import { expect, type Locator, type Page } from '@playwright/test'

import { choose, exactly, typeDate } from './fields'

/** How often a budget starts over, as the dialog's buttons word it. */
export type BudgetPeriodChoice = 'weekly' | 'biweekly' | 'monthly' | 'yearly'

/** What the budget dialog asks for. Leave out whatever shouldn't change. */
export interface BudgetFields {
  name?: string
  period?: BudgetPeriodChoice
  /** What it has each period, typed as in the field, e.g. `'2000'`. */
  amount?: string
  /** A day periods start on, YYYY-MM-DD, when it isn't the usual one. */
  startsOn?: string
}

/** Where to look for what counts in the link dialog. */
export type LinkTab = 'transactions' | 'account' | 'category' | 'subscription' | 'bill' | 'rule'

/**
 * The Budget tab: the cards that switch between budgets, how the period being looked at is
 * going, the charts, what counts toward it and the transactions that do, and the dialogs that
 * make budgets and choose what counts.
 */
export class BudgetPage {
  /** The row of budgets to choose between. */
  readonly switcher: Locator
  /** One card for each budget. */
  readonly cards: Locator
  /** The period being looked at, once it's loaded. */
  readonly period: Locator
  readonly summary: Locator
  /** What's left to spend, or by how much it's over. */
  readonly left: Locator
  /** What counts toward the budget besides single transactions, each with what it counted. */
  readonly sources: Locator
  /** The transactions that count in the period. */
  readonly transactions: Locator
  /** The make or change dialog, while it's open. */
  readonly dialog: Locator
  /** The add income or spending dialog, while it's open. */
  readonly linkDialog: Locator

  constructor(readonly page: Page) {
    this.switcher = page.getByTestId('budget-switcher')
    // The cards themselves, not the name and amounts inside them.
    this.cards = this.switcher.locator('button[data-test^="budget-card-"]')
    this.period = page.getByTestId('budget-period')
    this.summary = page.getByTestId('budget-summary')
    this.left = page.getByTestId('summary-left')
    this.sources = page.getByTestId('budget-source')
    this.transactions = page.getByTestId('budget-transaction')
    this.dialog = page.getByRole('dialog').filter({ has: page.getByTestId('budget-save') })
    this.linkDialog = page.getByRole('dialog').filter({ has: page.getByTestId('link-add') })
  }

  /** Opens the tab, on a budget and a period of it when given: `{ budget: id, on: '2026-08-01' }`. */
  async goto(query: { budget?: string; on?: string } = {}): Promise<void> {
    const search = new URLSearchParams(query).toString()
    const suffix = search ? `?${search}` : ''
    await this.page.goto(`/budget${suffix}`)
    await expect(this.page.getByTestId('budget-loading')).toHaveCount(0)
  }

  /** A budget's card, by name. */
  card(name: string): Locator {
    return this.cards.filter({
      has: this.page.getByTestId('budget-card-name').filter({ hasText: exactly(name) }),
    })
  }

  /** Looks at a budget, and waits for its period to load. */
  async choose(name: string): Promise<void> {
    await this.card(name).click()
    await expect(this.card(name)).toHaveAttribute('aria-pressed', 'true')
    await expect(this.period).toBeVisible()
  }

  /** What the summary says one of its tiles came to: `'income'`, `'spent'` or `'net'`. */
  tile(name: 'income' | 'spent' | 'net'): Locator {
    return this.page.getByTestId(`tile-${name}`).getByTestId('tile-value')
  }

  /** A source of what counts, by name. */
  source(name: string): Locator {
    return this.sources.filter({ hasText: name })
  }

  /** A transaction that counts, by its payee. */
  transaction(payee: string): Locator {
    return this.transactions.filter({ hasText: payee })
  }

  /** Opens the dialog that makes a budget, from the header or the switcher. */
  async openNew(): Promise<void> {
    await this.page
      .getByTestId('budget-new')
      .or(this.page.getByTestId('budget-add'))
      .or(this.page.getByTestId('budget-first'))
      .first()
      .click()
    await expect(this.dialog).toBeVisible()
  }

  /** Opens the dialog that changes the budget being looked at. */
  async openEdit(): Promise<void> {
    await this.page.getByTestId('budget-actions').click()
    await this.page.locator('.v-overlay--active').getByTestId('budget-edit').click()
    await expect(this.dialog).toBeVisible()
  }

  /** Fills in the dialog. */
  async fillIn(fields: BudgetFields): Promise<void> {
    const field = (testId: string) => this.dialog.getByTestId(testId)
    if (fields.name !== undefined) await field('budget-name').getByRole('textbox').fill(fields.name)
    if (fields.period) await this.dialog.getByTestId(`period-${fields.period}`).click()
    if (fields.amount !== undefined) {
      await field('budget-amount').getByRole('textbox').fill(fields.amount)
    }
    if (fields.startsOn !== undefined) await typeDate(field('budget-starts-on'), fields.startsOn)
  }

  /** Saves the dialog and waits for it to close. */
  async save(): Promise<void> {
    await this.dialog.getByTestId('budget-save').click()
    await expect(this.dialog).toBeHidden()
  }

  /** Opens the dialog that adds income or spending. */
  async openLink(kind: 'income' | 'spending'): Promise<void> {
    await this.page.getByTestId(`add-${kind}`).click()
    await expect(this.linkDialog).toBeVisible()
  }

  /** Goes to a way of choosing what counts: single transactions, an account, and so on. */
  async chooseTab(tab: LinkTab): Promise<void> {
    await this.linkDialog.getByTestId(`link-tab-${tab}`).click()
  }

  /** Searches the dialog's transactions for a payee, and ticks the first one found. */
  async tick(payee: string): Promise<void> {
    await this.linkDialog.getByTestId('finder-search').getByRole('searchbox').fill(payee)
    const row = this.linkDialog.getByTestId('finder-row').filter({ hasText: payee }).first()
    await expect(row).toBeVisible()
    await row.getByTestId('link-pick').getByRole('checkbox').check()
  }

  /** Picks an account, category, subscription, bill or automation in the dialog. */
  async pickIn(tab: Exclude<LinkTab, 'transactions'>, option: string): Promise<void> {
    await this.chooseTab(tab)
    await choose(this.linkDialog.getByTestId(`link-${tab}`), option)
  }

  /** Adds what was chosen and waits for the dialog to close. */
  async add(): Promise<void> {
    await this.linkDialog.getByTestId('link-add').click()
    await expect(this.linkDialog).toBeHidden()
  }

  /** Takes a transaction off the budget, by its payee. */
  async takeOff(payee: string): Promise<void> {
    await this.transaction(payee).getByTestId('take-off').click()
  }

  /** Shows the transactions that were taken off, or all of them, or just income or spending. */
  async showTransactions(filter: 'all' | 'income' | 'spending' | 'removed'): Promise<void> {
    await this.page.getByTestId(`filter-${filter}`).click()
  }
}
