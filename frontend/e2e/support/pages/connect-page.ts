import { expect, type Locator, type Page } from '@playwright/test'

import { choose, exactly, openOverlays } from './fields'

/** What a bank's menu offers. Choosing accounts and removing open a dialog; reconnecting and
 * sharing other accounts open Plaid Link. */
export type ConnectionAction = 'choose' | 'reconnect' | 'share' | 'history' | 'remove'

/**
 * The Connect tab: the connected banks, the wizard that connects one through Plaid Link and
 * chooses which of its accounts to import, and each bank's dialogs. Link itself is the `plaid`
 * fixture's.
 */
export class ConnectPage {
  /** Connect a bank, in the header or on the empty page. Admins only, once Plaid is set up. */
  readonly addButton: Locator
  /** The connected banks, a card each. */
  readonly cards: Locator
  /** The tiles at the top: banks, accounts imported, last sync and next sync. */
  readonly summary: Locator
  /** The connect wizard, which also chooses a connected bank's accounts, while it's open. */
  readonly wizard: Locator
  /** The accounts the wizard offers, a row each, with a box to tick to import it. */
  readonly accountRows: Locator
  /** A bank's sync history, while it's open. */
  readonly history: Locator
  /** The dialog asking to confirm removing a bank, while it's open. */
  readonly removeDialog: Locator

  constructor(readonly page: Page) {
    this.addButton = page.getByTestId('connect-add').or(page.getByTestId('connect-first'))
    this.cards = page.getByTestId('connection-card')
    this.summary = page.getByTestId('connect-summary')
    this.wizard = page.getByRole('dialog').filter({
      has: page.locator(
        '[data-test="connect-start"], [data-test="connect-accounts"], [data-test="connect-progress"], [data-test="connect-done"]',
      ),
    })
    this.accountRows = this.wizard.getByTestId('account-picker-row')
    this.history = page.getByRole('dialog', { name: /sync history$/ })
    this.removeDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByTestId('remove-connection-confirm') })
  }

  async goto(): Promise<void> {
    await this.page.goto('/connect')
    await expect(this.page.getByTestId('connections-loading')).toHaveCount(0)
  }

  /** A connected bank's card, by the bank's name. */
  card(bank: string): Locator {
    return this.cards.filter({
      has: this.page.getByTestId('connection-name').filter({ hasText: exactly(bank) }),
    })
  }

  /** A bank's status: "Up to date", "Syncing", "Sign-in needed", "Sync failed" or
   * "Importing history". */
  status(bank: string): Locator {
    return this.card(bank).getByTestId('connection-status')
  }

  /** An account a bank shares, in its card, by the name Cashcove shows. */
  account(bank: string, name: string): Locator {
    return this.card(bank)
      .getByTestId('connection-account')
      .filter({
        has: this.page.getByTestId('connection-account-name').filter({ hasText: exactly(name) }),
      })
  }

  /** Syncs a bank now, and waits until it has. */
  async syncNow(bank: string): Promise<void> {
    const synced = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/connections\/[^/]+\/sync$/.test(new URL(response.url()).pathname),
    )
    await this.card(bank).getByTestId('connection-sync').click()
    await synced
  }

  async act(bank: string, action: ConnectionAction): Promise<void> {
    await this.card(bank).getByTestId('connection-actions').click()
    await openOverlays(this.page).getByTestId(`connection-${action}`).click()
  }

  /**
   * Opens the wizard and goes on to Plaid Link, which the `plaid` fixture then drives.
   * `history` is how far back to import, as the wizard words it, e.g. `'Last 90 days'`.
   */
  async startConnecting({ history }: { history?: string } = {}): Promise<void> {
    await this.addButton.click()
    if (history) await choose(this.wizard.getByTestId('connect-history'), history)
    await this.wizard.getByTestId('connect-continue').click()
  }

  /** An account the wizard offers, by the name it shows. */
  accountRow(name: string): Locator {
    return this.accountRows.filter({
      has: this.page.getByTestId('account-picker-name').filter({ hasText: exactly(name) }),
    })
  }

  /** Ticks exactly these accounts in the wizard, by the names it shows. */
  async chooseAccounts(...names: string[]): Promise<void> {
    await expect(this.accountRows.first()).toBeVisible()
    for (const row of await this.accountRows.all()) {
      const name = (await row.getByTestId('account-picker-name').textContent())?.trim() ?? ''
      await row
        .getByTestId('account-picker-check')
        .getByRole('checkbox')
        .setChecked(names.includes(name))
    }
  }

  /** Gives an account the wizard offers a name of the household's own. */
  async renameAccount(name: string, to: string): Promise<void> {
    await this.accountRow(name).getByTestId('account-picker-rename').click()
    // The row shows the new name as it's typed, so find the one name field that's open.
    const field = this.wizard.getByTestId('account-picker-name-field').getByRole('textbox')
    await field.fill(to)
    await field.press('Enter')
  }

  /**
   * Imports the ticked accounts. A new bank's wizard goes on to what it imported; choosing a
   * connected bank's accounts closes it. For accounts that were imported and are now unticked,
   * `deleteRemoved` deletes their transactions rather than keeping them by hand.
   */
  async importAccounts({ deleteRemoved = false }: { deleteRemoved?: boolean } = {}): Promise<void> {
    if (deleteRemoved) await this.wizard.getByTestId('connect-removed-delete').click()
    await this.wizard.getByTestId('connect-import').click()
    await expect(this.wizard.getByTestId('connect-accounts')).toBeHidden()
  }

  /** Closes the wizard once it's done. */
  async finish(): Promise<void> {
    await this.wizard.getByTestId('connect-finish').click()
    await expect(this.wizard).toBeHidden()
  }

  /** Removes a bank, keeping its accounts to update by hand, or deleting them. */
  async remove(
    bank: string,
    { deleteAccounts = false }: { deleteAccounts?: boolean } = {},
  ): Promise<void> {
    await this.act(bank, 'remove')
    if (deleteAccounts) await this.removeDialog.getByTestId('remove-connection-delete').click()
    await this.removeDialog.getByTestId('remove-connection-confirm').click()
    await expect(this.removeDialog).toBeHidden()
  }
}
