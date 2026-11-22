import { expect, type Locator, type Page } from '@playwright/test'

export type ThemeMode = 'light' | 'dark' | 'system'

/**
 * Settings > Appearance: whether the app is light, dark or follows the device, and the color
 * theme it wears. Both are kept on the device, so viewers choose them too.
 */
export class AppearancePage {
  /** Every color theme, as buttons in a group. */
  readonly palettes: Locator

  constructor(readonly page: Page) {
    this.palettes = page.getByTestId('palette-options')
  }

  async goto(): Promise<void> {
    await this.page.goto('/settings/appearance')
    await expect(this.palettes).toBeVisible()
  }

  /** A color theme's button, by its id, e.g. `'ocean'`. */
  palette(id: string): Locator {
    return this.palettes.getByTestId(`palette-option-${id}`)
  }

  /** The Light, Dark or Match device button. */
  mode(value: ThemeMode): Locator {
    return this.page.getByTestId(`theme-option-${value}`)
  }

  async choosePalette(id: string): Promise<void> {
    await this.palette(id).click()
    await expect(this.palette(id)).toHaveAttribute('aria-pressed', 'true')
  }

  async chooseMode(value: ThemeMode): Promise<void> {
    await this.mode(value).click()
    await expect(this.mode(value)).toHaveAttribute('aria-pressed', 'true')
  }

  /** The app's main color as styles get it from Vuetify: `"red,green,blue"`, e.g. `"15,113,106"`. */
  async primary(): Promise<string> {
    return this.page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--v-theme-primary').trim(),
    )
  }
}
