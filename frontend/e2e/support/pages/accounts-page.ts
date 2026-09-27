import { expect, type Locator, type Page } from '@playwright/test'

import type { AccountType } from '../harness'
import { choose, exactly, openOverlays, startingWith } from './fields'

/** What the account dialog asks for. Leave out whatever shouldn't change. */
export interface AccountFields {
  type?: AccountType
  name?: string
  institution?: string
  /** The last 2 to 4 characters of the account number. */
  mask?: string
  /** What's in it, or for a card or loan, what's owed, as a positive amount. */
  balance?: string
  creditLimit?: string
  /** A currency code, e.g. `'EUR'`. */
  currency?: string
  notes?: string
}

/** What an account's menu offers. Closing and deleting ask to confirm first. */
export type AccountAction = 'edit' | 'transactions' | 'close' | 'reopen' | 'delete'

/** The Accounts tab: net worth, open accounts by kind, closed ones, and the account dialog. */
export class AccountsPage {
  /** Add account, in the header or on the empty page. Admins only. */
  readonly addButton: Locator
  readonly rows: Locator
  /** The net worth of the open accounts, e.g. "$14,337.78". */
  readonly netWorth: Locator
  readonly closedAccounts: Locator
  /** The add or edit dialog, while it's open. */
  readonly dialog: Locator

  constructor(readonly page: Page) {
    this.addButton = page.getByTestId('account-add').or(page.getByTestId('account-add-first'))
    this.rows = page.getByTestId('account-row')
    this.netWorth = page.getByTestId('net-worth-total')
    this.closedAccounts = page.getByTestId('accounts-closed')
    this.dialog = page.getByRole('dialog').filter({ has: page.getByTestId('account-save') })
  }

  async goto(): Promise<void> {
    await this.page.goto('/accounts')
    await expect(this.page.getByTestId('accounts-loading')).toHaveCount(0)
  }

  /** An account's row, by name. Closed accounts' rows show once `showClosed()` opens them. */
  row(name: string): Locator {
    return this.rows.filter({
      has: this.page.getByTestId('account-name').filter({ hasText: exactly(name) }),
    })
  }

  /** The balance an account's row shows, e.g. "$2,450.18". */
  balance(name: string): Locator {
    return this.row(name).getByTestId('account-balance')
  }

  async showClosed(): Promise<void> {
    await this.closedAccounts.getByRole('button', { name: startingWith('Closed accounts') }).click()
  }

  async act(name: string, action: AccountAction): Promise<void> {
    await this.row(name).getByTestId('account-actions').click()
    await openOverlays(this.page).getByTestId(`account-${action}`).click()
  }

  async fill(fields: AccountFields): Promise<void> {
    const field = (testId: string) => this.dialog.getByTestId(testId)
    if (fields.type) await field(`account-type-${fields.type}`).click()
    if (fields.name !== undefined) {
      await field('account-name-field').getByRole('textbox').fill(fields.name)
    }
    if (fields.institution !== undefined) {
      await field('account-institution').getByRole('textbox').fill(fields.institution)
    }
    if (fields.mask !== undefined) {
      await field('account-mask').getByRole('textbox').fill(fields.mask)
    }
    if (fields.balance !== undefined) {
      await field('account-balance-field').getByRole('textbox').fill(fields.balance)
    }
    if (fields.creditLimit !== undefined) {
      await field('account-credit-limit').getByRole('textbox').fill(fields.creditLimit)
    }
    if (fields.currency !== undefined) {
      await choose(field('account-currency'), startingWith(`${fields.currency} `), {
        search: fields.currency,
      })
    }
    if (fields.notes !== undefined) {
      await field('account-notes').getByRole('textbox').fill(fields.notes)
    }
  }

  /** Saves the dialog and waits for it to close. */
  async save(): Promise<void> {
    await this.dialog.getByTestId('account-save').click()
    await expect(this.dialog).toBeHidden()
  }
}
