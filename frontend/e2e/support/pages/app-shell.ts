import { expect, type Locator, type Page } from '@playwright/test'

import { openOverlays } from './fields'

/** The tabs in the navigation, by route name, with the title people see. */
export const TABS = {
  dashboard: 'Dashboard',
  accounts: 'Accounts',
  budget: 'Budget',
  subscriptions: 'Subscriptions',
  bills: 'Bills',
  transactions: 'Transactions',
  categories: 'Categories',
  automations: 'Automations',
  ai: 'AI',
  import: 'Import',
  connect: 'Connect',
  settings: 'Settings',
} as const

export type Tab = keyof typeof TABS

/**
 * The signed-in app's frame: its collapsible side menu, account menu and theme switcher.
 */
export class AppShell {
  readonly sideMenu: Locator
  readonly mobileMenuToggle: Locator
  readonly accountMenu: Locator
  readonly themeMenu: Locator

  constructor(readonly page: Page) {
    this.sideMenu = page.getByRole('navigation', { name: 'Main navigation' })
    this.mobileMenuToggle = page.getByTestId('mobile-nav-toggle')
    this.accountMenu = page.getByTestId('user-menu')
    this.themeMenu = page.getByTestId('theme-toggle')
  }

  /** Whether the app is showing its phone layout, once it has loaded. */
  async onPhone(): Promise<boolean> {
    await expect(this.accountMenu).toBeVisible()
    return (await this.mobileMenuToggle.count()) > 0
  }

  /** Opens the left-side menu when it is closed. */
  async showMenu(): Promise<void> {
    if (
      (await this.onPhone()) &&
      (await this.mobileMenuToggle.getAttribute('aria-expanded')) !== 'true'
    ) {
      await this.mobileMenuToggle.click()
    }
    await expect(this.sideMenu).toBeVisible()
  }

  /** Opens a tab from the side menu, on either screen size. */
  async open(tab: Tab): Promise<void> {
    await this.showMenu()
    await this.sideMenu.getByRole('link', { name: TABS[tab] }).click()
    await expect(this.page).toHaveURL(new RegExp(`/${tab}(/|$)`))
    if (await this.onPhone())
      await expect(this.mobileMenuToggle).toHaveAttribute('aria-expanded', 'false')
  }

  async chooseTheme(theme: 'light' | 'dark' | 'system'): Promise<void> {
    await this.themeMenu.click()
    await openOverlays(this.page).getByTestId(`theme-${theme}`).click()
  }

  async signOut(): Promise<void> {
    await this.accountMenu.click()
    await openOverlays(this.page).getByTestId('menu-sign-out').click()
    await expect(this.page).toHaveURL(/\/sign-in/)
  }
}
