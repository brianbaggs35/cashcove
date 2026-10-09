import { expect, type Locator, type Page, type Response } from '@playwright/test'

import type { StatementFile } from '../statements'
import { choose, exactly, openOverlays } from './fields'

/** What a CSV file's column can hold, as the columns step's menus word it. */
export type ColumnMatch =
  | 'Date'
  | 'Payee or description'
  | 'Amount'
  | 'Money in'
  | 'Money out'
  | 'In or out'
  | 'Memo or notes'
  | 'Category'
  | 'Transaction ID'
  | 'Balance'
  | 'Not imported'

/** Which of the file's rows the review step shows. */
export type RowFilter =
  'All' | 'Needs a look' | 'New' | 'Possible duplicates' | 'Already there' | 'Can’t be read'

/** What can be changed about a row the AI read off a PDF, in the dialog its pencil opens. */
export interface RowChanges {
  who?: string
  /** A positive amount, as it's typed: `direction` says which way the money went. */
  amount?: string
  direction?: 'Money in' | 'Money out'
  /** As the household's dates are written, e.g. `'09/04/2026'`. */
  date?: string
}

/** What importing does to an account kept by hand's balance: take the file's, add what's
 * imported, or leave it as it is. */
export type BalanceChoice = 'file' | 'move' | 'keep'

/**
 * The Import tab: the recent imports, the saved formats, and the dialog that imports a
 * statement file one step at a time, matching a CSV file's columns, then reviewing its rows.
 */
export class ImportPage {
  /** Where files are dropped or chosen. Admins only. */
  readonly fileDrop: Locator
  /** The recent imports, a row each, newest first. */
  readonly imports: Locator
  /** The saved formats, a row each, by name. */
  readonly formats: Locator
  /** The import dialog, while it's open. */
  readonly dialog: Locator
  /** The error the dialog shows, e.g. why a file can't be read. */
  readonly notice: Locator
  /** The columns step's rows, one for each of the file's columns. */
  readonly columnRows: Locator
  /** The review step's rows, one for each of the file's rows the filter shows. */
  readonly reviewRows: Locator
  /** The dialog asking to confirm undoing an import, while it's open. */
  readonly undoDialog: Locator
  /** The note that says the AI read the rows, and what it left out. */
  readonly statementNote: Locator
  readonly statementSkipped: Locator
  /** The dialog the pencil on a row opens, to correct what the AI read. */
  readonly rowDialog: Locator
  /** The steps the dialog goes through: the last is the AI's, when AI is set up. */
  readonly steps: Locator
  /** The AI's second opinion on the rows that were just imported. */
  readonly aiStep: Locator
  /** What the AI would change about them, a card for each. */
  readonly aiSuggestions: Locator
  /** What it says when it agrees with how everything was sorted. */
  readonly aiAgrees: Locator
  /** What it says once every suggestion has been decided. */
  readonly aiDecided: Locator

  constructor(readonly page: Page) {
    this.fileDrop = page.getByTestId('file-drop')
    this.imports = page.getByTestId('import-item')
    this.formats = page.getByTestId('saved-format')
    this.dialog = page.getByRole('dialog').filter({
      has: page.locator(
        '[data-test="import-progress"], [data-test="import-failed"], [data-test="import-columns"], [data-test="import-review"], [data-test="import-done"], [data-test="import-ai"]',
      ),
    })
    this.notice = this.dialog.getByTestId('import-notice')
    this.columnRows = this.dialog.getByTestId('column-row')
    this.reviewRows = this.dialog.getByTestId('review-row')
    this.undoDialog = page.getByRole('dialog', { name: /^Undo importing/ })
    this.statementNote = this.dialog.getByTestId('review-statement-note')
    this.statementSkipped = this.dialog.getByTestId('review-statement-skipped')
    this.rowDialog = page.getByRole('dialog', { name: 'Check this transaction' })
    this.steps = this.dialog.getByTestId('step-list').getByRole('listitem')
    this.aiStep = this.dialog.getByTestId('import-ai')
    this.aiSuggestions = this.dialog.getByTestId('recommendation')
    this.aiAgrees = this.dialog.getByTestId('import-ai-agrees')
    this.aiDecided = this.dialog.getByTestId('import-ai-decided')
  }

  async goto(): Promise<void> {
    await this.page.goto('/import')
    await expect(this.page.getByTestId('imports-loading')).toHaveCount(0)
  }

  /**
   * Chooses a file to import, and waits until it's read: on to matching a CSV file's columns,
   * straight to reviewing it, or saying why it can't be.
   */
  async chooseFile(file: StatementFile): Promise<void> {
    await this.page.getByTestId('file-input').setInputFiles(file)
    await expect(
      this.dialog.locator(
        '[data-test="import-columns"], [data-test="import-review"], [data-test="import-failed"]',
      ),
    ).toBeVisible()
  }

  /** The menu saying what a column holds, by the column's name, e.g. `'Posting Date'`. */
  columnMatch(column: string): Locator {
    return this.columnRows
      .filter({ has: this.page.getByTestId('column-name').filter({ hasText: exactly(column) }) })
      .getByTestId('column-choice')
  }

  /** Says what a column holds, and waits for the file to be read again that way. */
  async matchColumn(column: string, to: ColumnMatch): Promise<void> {
    await this.rereading(() => choose(this.columnMatch(column), to))
  }

  /** Goes on from the columns to reviewing the rows. */
  async continue(): Promise<void> {
    await this.dialog.getByTestId('import-continue').click()
    await expect(this.dialog.getByTestId('import-review')).toBeVisible()
  }

  /** Chooses the account to import into, and waits for the rows to be checked against it. */
  async chooseAccount(name: string): Promise<void> {
    await this.rereading(() => choose(this.dialog.getByTestId('review-account'), name))
  }

  /** A row the review step shows, by what the file or Cashcove calls it. */
  row(text: string): Locator {
    return this.reviewRows.filter({ hasText: text })
  }

  /** Ticks rows to import, or unticks them with `on: false`. */
  async tick(texts: string[], { on = true }: { on?: boolean } = {}): Promise<void> {
    await texts.reduce<Promise<void>>(
      (pending, text) =>
        pending.then(() =>
          this.row(text).getByTestId('review-row-check').getByRole('checkbox').setChecked(on),
        ),
      Promise.resolve(),
    )
  }

  /** Shows the rows of one kind, or `'All'` of them. */
  async showRows(filter: RowFilter): Promise<void> {
    await this.dialog
      .getByTestId('review-filters')
      .locator('.v-chip')
      .filter({ hasText: new RegExp(String.raw`^\s*${filter}\s+[\d,]+\s*$`) })
      .click()
  }

  /** Corrects a row the AI read, and waits for the rows to be read again with the change. */
  async editRow(text: string, changes: RowChanges): Promise<void> {
    await this.row(text).getByTestId('review-row-edit').click()
    await expect(this.rowDialog).toBeVisible()
    const field = (name: string) => this.rowDialog.getByTestId(`statement-row-${name}`)
    if (changes.direction) {
      await field('direction').getByRole('button', { name: changes.direction }).click()
    }
    if (changes.amount !== undefined)
      await field('amount').getByRole('textbox').fill(changes.amount)
    if (changes.date !== undefined) {
      // Enter would send the form before the rest is filled in.
      const date = field('date').getByRole('textbox')
      await date.fill(changes.date)
      await date.press('Tab')
    }
    if (changes.who !== undefined) await field('payee').getByRole('textbox').fill(changes.who)
    await this.rereading(() => field('save').click())
    await expect(this.rowDialog).toBeHidden()
  }

  /** Turns every row's money in to money out and the other way round, and waits for the rows. */
  async flipMoney(): Promise<void> {
    await this.rereading(() => this.dialog.getByTestId('review-flip').click())
  }

  /** Chooses what happens to the account's balance. */
  async chooseBalance(choice: BalanceChoice): Promise<void> {
    await this.dialog.getByTestId(`balance-${choice}`).getByRole('radio').check()
  }

  /** Names the format saved for the bank's next files, or with `false`, saves none. */
  async saveFormat(name: string | false): Promise<void> {
    const toggle = this.dialog.getByTestId('review-save-toggle').getByRole('checkbox')
    await toggle.setChecked(name !== false)
    if (name !== false)
      await this.dialog.getByTestId('review-format-name').getByRole('textbox').fill(name)
  }

  /** Imports the ticked rows, and waits until they're in. */
  async importRows(): Promise<void> {
    await this.dialog.getByTestId('import-submit').click()
    await expect(this.dialog.getByTestId('import-done')).toBeVisible()
  }

  /**
   * Imports the ticked rows when AI is set up, and waits until the AI has looked them over: it
   * either has suggestions, or agrees with how they were sorted.
   */
  async importRowsForAi(): Promise<void> {
    await this.dialog.getByTestId('import-submit').click()
    await expect(this.aiStep).toBeVisible()
    await expect(this.aiSuggestions.first().or(this.aiAgrees)).toBeVisible()
  }

  /** What the AI suggested for an imported row, by its payee. */
  aiSuggestion(payee: string | RegExp): Locator {
    return this.aiSuggestions.filter({
      has: this.page
        .getByTestId('reco-payee')
        .filter({ hasText: typeof payee === 'string' ? exactly(payee) : payee }),
    })
  }

  /** Once imported, goes to the Transactions tab showing what the import added. */
  async seeTransactions(): Promise<void> {
    await this.dialog.getByTestId('import-transactions').click()
    await expect(this.page).toHaveURL(/\/transactions\?import=/)
  }

  /** Closes the dialog, imported or not. */
  async close(): Promise<void> {
    await this.dialog
      .getByTestId('import-finish')
      .or(this.dialog.getByTestId('import-cancel'))
      .or(this.dialog.getByTestId('import-close'))
      .click()
    await expect(this.dialog).toBeHidden()
  }

  /** An import in the list, by its file's name. */
  importItem(fileName: string): Locator {
    return this.imports.filter({
      has: this.page.getByTestId('import-item-name').filter({ hasText: exactly(fileName) }),
    })
  }

  /** Undoes an import, which deletes what it added, once confirmed. */
  async undo(fileName: string): Promise<void> {
    await this.importItem(fileName).getByTestId('import-item-undo').click()
    await this.undoDialog.getByTestId('confirm-accept').click()
    await expect(this.importItem(fileName)).toHaveCount(0)
  }

  /** A saved format, by name. */
  format(name: string): Locator {
    return this.formats.filter({
      has: this.page.getByTestId('saved-format-name').filter({ hasText: exactly(name) }),
    })
  }

  async renameFormat(name: string, to: string): Promise<void> {
    await this.format(name).getByTestId('saved-format-actions').click()
    await openOverlays(this.page).getByTestId('saved-format-rename').click()
    const dialog = this.page.getByRole('dialog', { name: 'Rename saved format' })
    await dialog.getByTestId('format-name-field').getByRole('textbox').fill(to)
    await dialog.getByTestId('format-rename-save').click()
    await expect(dialog).toBeHidden()
  }

  async deleteFormat(name: string): Promise<void> {
    await this.format(name).getByTestId('saved-format-actions').click()
    await openOverlays(this.page).getByTestId('saved-format-delete').click()
    await this.page
      .getByRole('dialog', { name: `Delete the ${name} format?` })
      .getByTestId('confirm-accept')
      .click()
    await expect(this.format(name)).toHaveCount(0)
  }

  /** Does something that has the file read again, and waits for the new reading. */
  private async rereading(act: () => Promise<void>): Promise<Response> {
    const read = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === '/api/imports/preview',
    )
    await act()
    return read
  }
}
