import { expect, type Locator, type Page } from '@playwright/test'

import type { AiProviderKey } from '../ai'
import { choose, openOverlays } from './fields'

/**
 * Settings > AI: where the AI runs, its key and model, trying them before they're saved, and
 * turning AI off.
 */
export class AiSettingsPage {
  /** "Off", or "On · GPT-6 Luna". */
  readonly status: Locator
  readonly form: Locator
  /** What a viewer sees instead of the form. */
  readonly summary: Locator
  /** Ollama's address, for Ollama on the household's computer. */
  readonly address: Locator
  /** The provider's API key, in a box that hides it. */
  readonly key: Locator
  /** The models to choose from. */
  readonly model: Locator
  readonly fetchButton: Locator
  readonly testButton: Locator
  readonly saveButton: Locator
  readonly offButton: Locator
  /** What fetching Ollama's models found. */
  readonly fetched: Locator
  readonly fetchError: Locator
  /** Whether the provider answered the test, or what to fix. */
  readonly testResult: Locator
  /** Why a save failed. */
  readonly problem: Locator
  /** What the AI is and isn't told, in full. */
  readonly privacy: Locator

  constructor(readonly page: Page) {
    this.status = page.getByTestId('ai-status')
    this.form = page.getByTestId('ai-form')
    this.summary = page.getByTestId('ai-summary')
    this.address = page.getByTestId('ai-url')
    this.key = page.getByTestId('ai-key')
    this.model = page.getByTestId('ai-model')
    this.fetchButton = page.getByTestId('ai-fetch')
    this.testButton = page.getByTestId('ai-test')
    this.saveButton = page.getByTestId('ai-save')
    this.offButton = page.getByTestId('ai-off')
    this.fetched = page.getByTestId('ai-fetched')
    this.fetchError = page.getByTestId('ai-fetch-error')
    this.testResult = page.getByTestId('ai-test-result')
    this.problem = page.getByTestId('ai-error')
    this.privacy = page.getByTestId('ai-privacy')
  }

  async goto(): Promise<void> {
    await this.page.goto('/settings/ai')
    await expect(this.page.getByTestId('ai-settings')).toBeVisible()
    await expect(this.page.getByTestId('ai-settings-loading')).toHaveCount(0)
  }

  /** The card for one of the providers. */
  provider(provider: AiProviderKey): Locator {
    return this.page.getByTestId(`provider-${provider}`)
  }

  /** Chooses where the AI runs. */
  async chooseProvider(provider: AiProviderKey): Promise<void> {
    await this.provider(provider).getByRole('radio').check()
  }

  async enterKey(key: string): Promise<void> {
    await this.key.locator('input').fill(key)
  }

  async enterAddress(address: string): Promise<void> {
    await this.address.getByRole('textbox').fill(address)
  }

  /** Fetches the models an Ollama server has, and waits for what it says. */
  async fetchModels(): Promise<void> {
    await this.fetchButton.click()
    await expect(this.fetched.or(this.fetchError)).toBeVisible()
  }

  async chooseModel(name: string | RegExp): Promise<void> {
    await choose(this.model, name)
  }

  /** The names of the models the menu offers, in order. */
  async modelChoices(): Promise<string[]> {
    await this.model.locator('.v-field').click()
    const titles = openOverlays(this.page).getByRole('option').locator('.v-list-item-title')
    await expect(titles.first()).toBeVisible()
    const names = (await titles.allTextContents()).map((name) => name.trim())
    await this.page.keyboard.press('Escape')
    await expect(openOverlays(this.page)).toHaveCount(0)
    return names
  }

  /** Tries the connection with what's in the form, and waits for the answer. */
  async test(): Promise<void> {
    await this.testButton.click()
    await expect(this.testResult).toBeVisible()
  }

  async save(): Promise<void> {
    await this.saveButton.click()
  }

  /** Turns AI off once confirmed. */
  async turnOff(): Promise<void> {
    await this.offButton.click()
    await this.page
      .getByRole('dialog', { name: 'Turn off AI?' })
      .getByTestId('confirm-accept')
      .click()
    await expect(this.status).toHaveText('Off')
  }
}
