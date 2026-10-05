import { expect, type Locator, type Page } from '@playwright/test'

import { choose, exactly, openOverlays, startingWith } from './fields'

/** What a bill's menu offers. Deleting asks to confirm first. */
export type BillAction = 'toggle' | 'edit' | 'delete'

/** What the add and change dialog asks for, in the order it asks. Leave out what shouldn't change. */
export interface BillFields {
  name?: string
  /** What a payment is, or an estimate of it when `varies`. */
  amount?: string
  /** Whether the amount is a different one each time, like electricity. */
  varies?: boolean
  frequency?: string
  /** The date of the next payment, as YYYY-MM-DD. */
  dueDate?: string
  /** The account it's paid from; the account's name. */
  account?: string
  /** A past payment to start from, by its payee. It links the others like it, and later ones. */
  payment?: string
  payee?: string
  category?: string
  notes?: string
}

/**
 * The Bills tab: its bills as cards, and the dialog that adds and changes them. A bill is a
 * recurring payment like a subscription, so the page works the same way.
 */
export class BillsPage {
  /** Add bill, in the header or on the empty page. Admins only. */
  readonly addButton: Locator
  readonly cards: Locator
  /** The add or change dialog, while it's open. */
  readonly dialog: Locator
  /** Warns of bills past their due date with no payment linked. */
  readonly overdueAlert: Locator
  /** Warns of bills due within the reminder window. */
  readonly dueAlert: Locator

  constructor(readonly page: Page) {
    this.addButton = page.getByTestId('bill-add').or(page.getByTestId('bill-add-first'))
    this.cards = page.getByTestId('bill-card')
    this.dialog = page.getByRole('dialog').filter({ has: page.getByTestId('bill-name') })
    this.overdueAlert = page.getByTestId('bills-overdue-alert')
    this.dueAlert = page.getByTestId('bills-due-alert')
  }

  async goto(): Promise<void> {
    await this.page.goto('/bills')
    await expect(this.page.getByTestId('bills-loading')).toHaveCount(0)
  }

  /** A bill's card, by name. */
  card(name: string): Locator {
    return this.cards.filter({
      has: this.page.getByTestId('bill-title').filter({ hasText: exactly(name) }),
    })
  }

  async act(name: string, action: BillAction): Promise<void> {
    await this.card(name).getByTestId('bill-actions').click()
    await openOverlays(this.page).getByTestId(`bill-${action}`).click()
  }

  /** Fills in the dialog. */
  async fillIn(fields: BillFields): Promise<void> {
    const field = (testId: string) => this.dialog.getByTestId(`bill-${testId}`)
    if (fields.name !== undefined) await field('name').getByRole('textbox').fill(fields.name)
    if (fields.account !== undefined) await choose(field('account'), fields.account)
    if (fields.payment !== undefined) {
      await choose(field('seed-transaction'), startingWith(fields.payment), {
        search: fields.payment,
      })
    }
    if (fields.amount !== undefined) await field('amount').getByRole('textbox').fill(fields.amount)
    if (fields.varies !== undefined) {
      const box = field('varies').getByRole('checkbox')
      if (fields.varies) await box.check()
      else await box.uncheck()
    }
    if (fields.frequency !== undefined) await choose(field('frequency'), fields.frequency)
    if (fields.dueDate !== undefined) {
      // Tab rather than Enter, which would save the dialog.
      const [year, month, day] = fields.dueDate.split('-')
      const due = field('due-date').getByRole('textbox')
      await due.fill(`${month}/${day}/${year}`)
      await due.press('Tab')
    }
    if (fields.payee !== undefined) await field('payee').getByRole('textbox').fill(fields.payee)
    if (fields.category !== undefined) await choose(field('category'), fields.category)
    if (fields.notes !== undefined)
      await field('notes').locator('textarea').first().fill(fields.notes)
  }

  /** Saves the dialog and waits for it to close. */
  async save(): Promise<void> {
    await this.dialog.getByTestId('bill-save').click()
    await expect(this.dialog).toBeHidden()
  }
}
