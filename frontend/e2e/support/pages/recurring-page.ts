import { expect, type Locator, type Page } from '@playwright/test'

import { openOverlays } from './fields'

/** Which of the two a page is about. */
export type RecurringKind = 'subscription' | 'bill'

/**
 * What the page's own menu offers, besides editing. Deleting asks to confirm first. Cancelling and
 * reactivating each open a dialog to say a day, and only one is offered: one that has stopped can
 * be reactivated, and any other can be cancelled.
 */
export type PageAction = 'toggle' | 'cancel' | 'reactivate-item' | 'delete'

/** What a payment's menu offers. Taking one off asks to confirm first. */
export type PaymentAction = 'details' | 'unlink'

/**
 * The page of one subscription or bill: what it costs and when it falls due, the payments linked
 * to it, what is coming and what else refers to it. Admins change it, link payments to it and
 * take them off from here.
 */
export class RecurringPage {
  readonly title: Locator
  /** The trail to the tab on a computer, or the way back to it on a phone. */
  readonly way: Locator
  /** The first link of the trail, or the back button: either goes back to the tab. */
  readonly back: Locator
  readonly stats: Locator
  readonly payments: Locator
  readonly paymentRows: Locator
  readonly upcoming: Locator
  readonly details: Locator
  readonly related: Locator
  readonly missing: Locator

  constructor(readonly page: Page) {
    this.title = page.getByRole('heading', { level: 1 })
    this.way = page.getByTestId('show-breadcrumbs')
    this.back = page
      .getByTestId('breadcrumb-back')
      .or(page.getByTestId('breadcrumb-trail').getByRole('link'))
    this.stats = page.getByTestId('subscription-stats')
    this.payments = page.getByTestId('subscription-payments')
    this.paymentRows = page.getByTestId('payment-item')
    this.upcoming = page.getByTestId('upcoming-payments')
    this.details = page.getByTestId('subscription-details')
    this.related = page.getByTestId('subscription-related')
    this.missing = page.getByTestId('show-missing')
  }

  async goto(kind: RecurringKind, id: string): Promise<void> {
    await this.page.goto(`/${kind}s/${id}`)
    await expect(this.page.getByTestId('show-loading')).toHaveCount(0)
    await expect(this.title.or(this.missing)).toBeVisible()
  }

  /** Says where the page is: the whole trail on a computer, and the way back to the tab on a phone. */
  async expectPlace(current: string, tab: string): Promise<void> {
    const back = this.page.getByTestId('breadcrumb-back')
    if (await back.count()) await expect(back).toHaveText(tab)
    else await expect(this.way).toContainText(current)
  }

  /** The dialog that links payments to it and takes them off, while it's open. */
  linkDialog(kind: RecurringKind): Locator {
    return this.page.getByTestId(`${kind}-payments-dialog`)
  }

  /** What the page's menu offers, from its ⋮ button. */
  async act(action: PageAction): Promise<void> {
    await this.page.getByTestId('show-actions').click()
    await openOverlays(this.page).getByTestId(`show-${action}`).click()
  }

  /** A payment's row, in the order they are listed: the newest first. */
  payment(index: number): Locator {
    return this.paymentRows.nth(index)
  }

  /** What a payment's menu offers, from its ⋮ button. */
  async actOnPayment(index: number, action: PaymentAction): Promise<void> {
    await this.payment(index).getByTestId('payment-actions').click()
    await openOverlays(this.page).getByTestId(`payment-${action}`).click()
  }

  /** The figure of a tile at the top, e.g. `paid`, `due`, `cost` or `expected`. */
  stat(name: 'expected' | 'due' | 'cost' | 'paid'): Locator {
    return this.page.getByTestId(`stat-${name}`)
  }

  /** Opens the dialog from the payments card, and waits for what it lists. */
  async openLinking(kind: RecurringKind): Promise<Locator> {
    await this.page.getByTestId('payments-link').click()
    const dialog = this.linkDialog(kind)
    await expect(dialog.getByTestId('payments-summary')).toBeVisible()
    return dialog
  }

  /** Ticks a payment in the dialog's list, by its ID. */
  async choosePayment(dialog: Locator, id: string): Promise<void> {
    await dialog.getByTestId(`payment-select-${id}`).getByRole('checkbox').check()
  }
}
