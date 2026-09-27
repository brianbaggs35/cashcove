import { expect, type Locator, type Page } from '@playwright/test'

import { choose, comboboxInput, typeDate } from './fields'

/** What the transaction dialog asks for. Leave out whatever shouldn't change. */
export interface TransactionFields {
  direction?: 'in' | 'out'
  /** A positive amount; `direction` says which way the money went. */
  amount?: string
  /** YYYY-MM-DD */
  date?: string
  payee?: string
  /** A category's name. */
  category?: string
  /** An account's name. Only open accounts kept by hand take new transactions. */
  account?: string
  notes?: string
}

/**
 * The Transactions tab: search, the period and other filters, the list (a table on computers,
 * a list by day on phones), selecting several at once, and the transaction dialog.
 */
export class TransactionsPage {
  /** Add transaction, in the header or on the empty page. Admins only. */
  readonly addButton: Locator
  readonly search: Locator
  readonly period: Locator
  readonly filtersButton: Locator
  /** The filters in use, each with a button to take it off. */
  readonly chips: Locator
  /** How many transactions match, and the money in, out and net. */
  readonly totals: Locator
  /** The transactions on this page: table rows on computers, list items on phones. */
  readonly rows: Locator
  /** The add, edit or view dialog, while it's open. */
  readonly dialog: Locator
  readonly filterDialog: Locator
  /** What to do with the selected transactions. Computers only. */
  readonly bulkBar: Locator
  /** Shown instead of the list when nothing matches the filters. */
  readonly noneMatch: Locator

  constructor(readonly page: Page) {
    this.addButton = page
      .getByTestId('transaction-add')
      .or(page.getByTestId('transaction-add-first'))
    this.search = page.getByTestId('transaction-search').getByRole('searchbox')
    this.period = page.getByTestId('transaction-period')
    this.filtersButton = page.getByTestId('transaction-filters')
    this.chips = page.getByTestId('filter-chips')
    this.totals = page.getByTestId('transaction-totals')
    this.rows = page.getByTestId('transaction-row').or(page.getByTestId('transaction-item'))
    this.dialog = page.getByRole('dialog').filter({ has: page.getByTestId('transaction-notes') })
    this.filterDialog = page.getByRole('dialog').filter({ has: page.getByTestId('filter-apply') })
    this.bulkBar = page.getByTestId('bulk-bar')
    this.noneMatch = page.getByTestId('transactions-none-match')
  }

  /** Opens the tab, e.g. with `{ q: 'coffee' }` or `{ account: id }` already applied. */
  async goto(query: Record<string, string> = {}): Promise<void> {
    const search = new URLSearchParams(query).toString()
    await this.page.goto(`/transactions${search ? `?${search}` : ''}`)
    await expect(this.page.getByTestId('transactions-loading')).toHaveCount(0)
  }

  /** A transaction's row or list item, by its payee. */
  row(payee: string | RegExp): Locator {
    return this.rows.filter({ hasText: payee })
  }

  /** Opens a transaction's dialog: to edit it as an admin, or to see it as a viewer. */
  async open(payee: string | RegExp): Promise<void> {
    const row = this.row(payee)
    await expect(row).toBeVisible()
    // A table row has its own button; a phone's list item opens when tapped.
    const button = row.getByTestId('transaction-open')
    await ((await button.count()) ? button : row).click()
    await expect(this.dialog).toBeVisible()
  }

  /** Searches right away, without waiting for a pause in typing. */
  async searchFor(text: string): Promise<void> {
    await this.search.fill(text)
    await this.search.press('Enter')
  }

  /** Picks a period by its title, e.g. `'This month'`. */
  async choosePeriod(title: string): Promise<void> {
    await choose(this.period, title)
  }

  async openFilters(): Promise<void> {
    await this.filtersButton.click()
    await expect(this.filterDialog).toBeVisible()
  }

  async applyFilters(): Promise<void> {
    await this.filterDialog.getByTestId('filter-apply').click()
    await expect(this.filterDialog).toBeHidden()
  }

  /** Ticks transactions in the table, by payee. Computers only. */
  async select(...payees: (string | RegExp)[]): Promise<void> {
    for (const payee of payees) await this.row(payee).getByRole('checkbox').check()
    await expect(this.bulkBar).toBeVisible()
  }

  /** Gives the selected transactions a category. */
  async categorizeSelected(category: string): Promise<void> {
    await this.bulkBar.getByTestId('bulk-categorize').click()
    const dialog = this.page
      .getByRole('dialog')
      .filter({ has: this.page.getByTestId('categorize-apply') })
    await choose(dialog.getByTestId('categorize-category'), category)
    await dialog.getByTestId('categorize-apply').click()
    await expect(dialog).toBeHidden()
  }

  /** Deletes the selected transactions, confirming when asked. */
  async deleteSelected(): Promise<void> {
    await this.bulkBar.getByTestId('bulk-delete').click()
    await this.page.getByTestId('confirm-accept').click()
    await expect(this.bulkBar).toBeHidden()
  }

  async fill(fields: TransactionFields): Promise<void> {
    const field = (testId: string) => this.dialog.getByTestId(testId)
    if (fields.direction) {
      const name = fields.direction === 'in' ? 'Money in' : 'Money out'
      await field('transaction-direction').getByRole('button', { name }).click()
    }
    if (fields.amount !== undefined) {
      await field('transaction-amount').getByRole('textbox').fill(fields.amount)
    }
    if (fields.date !== undefined) await typeDate(field('transaction-date'), fields.date)
    if (fields.payee !== undefined) {
      const payee = comboboxInput(field('transaction-payee'))
      await payee.fill(fields.payee)
      // Leaving the field keeps what was typed and closes its suggestions.
      await payee.press('Tab')
    }
    if (fields.category !== undefined) await choose(field('transaction-category'), fields.category)
    if (fields.account !== undefined) await choose(field('transaction-account'), fields.account)
    if (fields.notes !== undefined) {
      await field('transaction-notes').getByRole('textbox').fill(fields.notes)
    }
  }

  /** Saves the dialog and waits for it to close. */
  async save(): Promise<void> {
    await this.dialog.getByTestId('transaction-save').click()
    await expect(this.dialog).toBeHidden()
  }

  /** Deletes the open transaction, confirming when asked. */
  async deleteOpen(): Promise<void> {
    await this.dialog.getByTestId('transaction-delete').click()
    await this.page.getByTestId('confirm-accept').click()
    await expect(this.dialog).toBeHidden()
  }
}
