import { expect, type Locator, type Page } from '@playwright/test'

import { choose, exactly, openOverlays } from './fields'

/** How what an automation looks for is compared, as the dialog's menu words it. */
export type AutomationMatch = 'Exactly' | 'Starts with' | 'Contains'

/** How much a transaction has to be for: one amount, or between two, either of which can be left out. */
export type AutomationAmount = { exactly: string } | { from?: string; to?: string }

/**
 * What the automation dialog asks for, in the order it asks. Leave out whatever shouldn't
 * change.
 */
export interface AutomationFields {
  /** Payees to tick, by searching the transactions for each and ticking its first match. */
  payees?: string[]
  /** Text to look for, typed in. */
  texts?: string[]
  /** How the payees and texts are compared with a transaction's payee and the bank's name for it. */
  match?: AutomationMatch
  /** Only this account's transactions; the account's name. */
  account?: string
  /** Only transactions for this much. */
  amount?: AutomationAmount
  name?: string
  category?: string
  subscription?: string
  applyTo?: 'all' | 'future'
}

/** What an automation's menu offers. Deleting asks to confirm first. */
export type AutomationAction = 'toggle' | 'edit' | 'delete'

/**
 * The Automations tab: its automations as cards, and the dialog that adds and changes them in
 * two steps. The first finds the transactions, by ticking them or typing what to look for and
 * fine-tuning how, where and for how much. The second says what happens to them.
 */
export class AutomationsPage {
  /** New automation, in the header or on the empty page. Admins only. */
  readonly addButton: Locator
  readonly cards: Locator
  /** The add or edit dialog, while it's open. */
  readonly dialog: Locator

  constructor(readonly page: Page) {
    this.addButton = page.getByTestId('automation-add').or(page.getByTestId('automation-add-first'))
    this.cards = page.getByTestId('automation-card')
    this.dialog = page.getByRole('dialog').filter({ has: page.getByTestId('automation-text') })
  }

  async goto(): Promise<void> {
    await this.page.goto('/automations')
    await expect(this.page.getByTestId('automations-loading')).toHaveCount(0)
  }

  /** An automation's card, by name. */
  card(name: string): Locator {
    return this.cards.filter({
      has: this.page.getByTestId('automation-title').filter({ hasText: exactly(name) }),
    })
  }

  async act(name: string, action: AutomationAction): Promise<void> {
    await this.card(name).getByTestId('automation-actions').click()
    await openOverlays(this.page).getByTestId(`automation-${action}`).click()
  }

  /** Searches the dialog's transactions for a payee, and ticks the first one found. */
  async tick(payee: string): Promise<void> {
    await this.dialog.getByTestId('finder-search').getByRole('searchbox').fill(payee)
    const row = this.dialog.getByTestId('finder-row').filter({ hasText: payee }).first()
    await expect(row).toBeVisible()
    await row.getByTestId('automation-pick').getByRole('checkbox').check()
    await expect(
      this.dialog.getByTestId('automation-chosen-payee').filter({ hasText: payee }),
    ).toBeVisible()
  }

  /** Types text to look for, and adds it. */
  async addText(text: string): Promise<void> {
    await this.dialog.getByTestId('automation-text').getByRole('textbox').fill(text)
    await this.dialog.getByTestId('automation-text-add').click()
    await expect(
      this.dialog.getByTestId('automation-chosen-payee').filter({ hasText: text }),
    ).toBeVisible()
  }

  /** Opens the panel that fine-tunes the matching, if it isn't open. */
  async openFineTuning(): Promise<void> {
    const title = this.dialog.getByTestId('automation-fine-tune').getByRole('button', {
      name: /Fine-tune matching/,
    })
    if ((await title.getAttribute('aria-expanded')) !== 'true') await title.click()
    await expect(title).toHaveAttribute('aria-expanded', 'true')
  }

  /** Says how much a transaction has to be for. */
  async chooseAmount(amount: AutomationAmount | 'any'): Promise<void> {
    await this.openFineTuning()
    const mode = this.dialog.getByTestId('automation-amount-mode')
    if (amount === 'any') {
      await mode.getByRole('button', { name: 'Any amount' }).click()
    } else if ('exactly' in amount) {
      await mode.getByRole('button', { name: 'Exactly' }).click()
      await this.dialog.getByTestId('automation-amount').getByRole('textbox').fill(amount.exactly)
    } else {
      await mode.getByRole('button', { name: 'Between' }).click()
      if (amount.from !== undefined) {
        await this.dialog
          .getByTestId('automation-amount-from')
          .getByRole('textbox')
          .fill(amount.from)
      }
      if (amount.to !== undefined) {
        await this.dialog.getByTestId('automation-amount-to').getByRole('textbox').fill(amount.to)
      }
    }
  }

  /** The first step: finds the transactions. */
  async findIn(fields: AutomationFields): Promise<void> {
    for (const payee of fields.payees ?? []) await this.tick(payee)
    for (const text of fields.texts ?? []) await this.addText(text)
    if (fields.match !== undefined) {
      await this.openFineTuning()
      await choose(this.dialog.getByTestId('automation-match'), fields.match)
    }
    if (fields.account !== undefined) {
      await this.openFineTuning()
      await choose(this.dialog.getByTestId('automation-account'), fields.account)
    }
    if (fields.amount !== undefined) await this.chooseAmount(fields.amount)
  }

  /** Goes on to what should happen. */
  async next(): Promise<void> {
    await this.dialog.getByTestId('automation-next').click()
    await expect(this.dialog.getByTestId('automation-save')).toBeVisible()
  }

  /** Goes back to finding the transactions. */
  async back(): Promise<void> {
    await this.dialog.getByTestId('automation-back').click()
    await expect(this.dialog.getByTestId('automation-next')).toBeVisible()
  }

  /** The second step: says what happens. */
  async thenFill(fields: AutomationFields): Promise<void> {
    const field = (testId: string) => this.dialog.getByTestId(testId)
    if (fields.name !== undefined) {
      await field('automation-name').getByRole('textbox').fill(fields.name)
    }
    if (fields.category !== undefined) await choose(field('automation-category'), fields.category)
    if (fields.subscription !== undefined) {
      await choose(field('automation-subscription'), fields.subscription)
    }
    if (fields.applyTo) {
      await field(`automation-apply-${fields.applyTo}`).getByRole('radio').check()
    }
  }

  /** Fills in both steps, which it goes through when it is on the first. */
  async fillIn(fields: AutomationFields): Promise<void> {
    await this.findIn(fields)
    if (await this.dialog.getByTestId('automation-next').isVisible()) await this.next()
    await this.thenFill(fields)
  }

  /** Saves the dialog and waits for it to close. */
  async save(): Promise<void> {
    await this.dialog.getByTestId('automation-save').click()
    await expect(this.dialog).toBeHidden()
  }
}
