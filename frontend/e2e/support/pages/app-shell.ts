import { expect, type Locator, type Page } from '@playwright/test'

/** The tabs in the navigation, by route name, with the title people see. */
export const TABS = {
  accounts: 'Accounts',
  budget: 'Budget',
  subscriptions: 'Subscriptions',
  transactions: 'Transactions',
  import: 'Import',
  connect: 'Connect',
  settings: 'Settings',
} as const

export type Tab = keyof typeof TABS

/** The tabs a phone shows in its bottom bar; the rest are under More. */
const BOTTOM_BAR_TABS: readonly Tab[] = ['accounts', 'transactions', 'budget', 'subscriptions']

/**
 * The signed-in app's frame: the navigation (a side menu on computers, a bottom bar on
 * phones), the account menu and the theme switcher.
 */
export class AppShell {
  readonly sideMenu: Locator
  readonly bottomBar: Locator
  readonly accountMenu: Locator
  readonly themeMenu: Locator

  constructor(readonly page: Page) {
    this.sideMenu = page.getByRole('navigation', { name: 'Main navigation' })
    this.bottomBar = page.getByRole('navigation', { name: 'Quick navigation' })
    this.accountMenu = page.getByTestId('user-menu')
    this.themeMenu = page.getByTestId('theme-toggle')
  }

  /** Whether the app is showing its phone layout, once it has loaded. */
  async onPhone(): Promise<boolean> {
    await expect(this.accountMenu).toBeVisible()
    return (await this.bottomBar.count()) > 0
  }

  /** Opens a tab the way someone would: from the side menu, or the bottom bar on a phone. */
  async open(tab: Tab): Promise<void> {
    if (await this.onPhone()) {
      if (BOTTOM_BAR_TABS.includes(tab)) {
        await this.page.getByTestId(`bottom-${tab}`).click()
      } else {
        await this.page.getByTestId('bottom-more').click()
        await this.sideMenu.getByRole('link', { name: TABS[tab] }).click()
      }
    } else {
      await this.sideMenu.getByRole('link', { name: TABS[tab] }).click()
    }
    await expect(this.page).toHaveURL(new RegExp(`/${tab}(/|$)`))
  }

  async chooseTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.themeMenu.click()
    await this.page.getByTestId(`theme-${theme}`).click()
  }

  async signOut(): Promise<void> {
    await this.accountMenu.click()
    await this.page.getByTestId('menu-sign-out').click()
    await expect(this.page).toHaveURL(/\/sign-in/)
  }
}
