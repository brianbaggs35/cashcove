import { expect, type Locator, type Page } from '@playwright/test'

/** The three figures at the top of the month's card. */
export type MonthFigure = 'income' | 'spent' | 'saved'

/** An amount as the app shows it in dollars, e.g. `'1234.5'` as "$1,234.50". */
export function usd(amount: string | number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
    Number(amount),
  )
}

/**
 * The Dashboard: net worth, how the month is going, the charts, budgets, what is coming up, the
 * payees most was spent with and the latest transactions, each of which links to its own tab.
 */
export class DashboardPage {
  readonly netWorth: Locator
  readonly month: Locator
  /** What came in and what was spent, in each of the latest months, as the chart's buttons. */
  readonly cashFlowMonths: Locator
  /** The parts of the ring of where the money went, written out beside it. */
  readonly spendingParts: Locator
  readonly budgets: Locator
  readonly comingUp: Locator
  readonly topPayees: Locator
  readonly recent: Locator
  /** Banks that need attention, and transactions with no category. */
  readonly attention: Locator

  constructor(readonly page: Page) {
    this.netWorth = page.getByTestId('net-worth-total')
    this.month = page.getByTestId('month-summary')
    this.cashFlowMonths = page.getByTestId('cash-flow-month')
    this.spendingParts = page.getByTestId('spending-part')
    this.budgets = page.getByTestId('budget-progress-row')
    this.comingUp = page.getByTestId('coming-up-item')
    this.topPayees = page.getByTestId('top-payee')
    this.recent = page.getByTestId('recent-transaction')
    this.attention = page.getByTestId('attention')
  }

  /** Opens the tab, once what it shows has loaded. */
  async goto(): Promise<void> {
    await this.page.goto('/dashboard')
    await expect(this.page.getByTestId('dashboard-loading')).toHaveCount(0)
    await expect(this.month).toBeVisible()
  }

  /** What came in, was spent or was left over this month, e.g. "$2,400.00". */
  figure(name: MonthFigure): Locator {
    return this.page.getByTestId(`month-${name}`).getByTestId('month-value')
  }

  /** How a figure compares with the same days last month, in words. */
  change(name: MonthFigure): Locator {
    return this.page.getByTestId(`month-${name}`).getByTestId('month-change')
  }

  /** A budget's row, by name. */
  budget(name: string): Locator {
    return this.budgets.filter({ hasText: name })
  }

  /** Today's date where the browser is, which is what the dashboard calls this month by. */
  async today(): Promise<string> {
    return this.page.evaluate(() => {
      const now = new Date()
      const pad = (value: number) => String(value).padStart(2, '0')
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    })
  }

  /** Whether the page is wider than the screen, which scrolls sideways on a phone. */
  async overflowsSideways(): Promise<boolean> {
    return this.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
  }
}
