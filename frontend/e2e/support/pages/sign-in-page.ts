import { expect, type Locator, type Page } from '@playwright/test'

/** The sign-in page, with its password, authenticator-code and recovery-code steps. */
export class SignInPage {
  readonly email: Locator
  readonly password: Locator
  readonly remember: Locator
  readonly submit: Locator
  readonly codeInput: Locator
  readonly recoveryCode: Locator
  /** The message shown when something didn't work. */
  readonly error: Locator
  /** The note at the top, e.g. after signing out or when a session ended. */
  readonly notice: Locator

  constructor(readonly page: Page) {
    this.email = page.getByTestId('sign-in-email').locator('input')
    this.password = page.getByTestId('sign-in-password').locator('input')
    this.remember = page.getByTestId('sign-in-remember').locator('input')
    this.submit = page.getByTestId('sign-in-submit')
    // One real text box sits under the six digit boxes people see.
    this.codeInput = page.getByTestId('code-input').getByRole('textbox')
    this.recoveryCode = page.getByTestId('recovery-code').locator('input')
    this.error = page.getByTestId('sign-in-error')
    this.notice = page.getByTestId('sign-in-notice')
  }

  async goto(): Promise<void> {
    await this.page.goto('/sign-in')
    await expect(this.email).toBeVisible()
  }

  /** Enters an email and password and presses Sign in. */
  async signIn(
    user: { email: string; password: string },
    { remember = false }: { remember?: boolean } = {},
  ): Promise<void> {
    await this.email.fill(user.email)
    await this.password.fill(user.password)
    if (remember) await this.remember.check()
    await this.submit.click()
  }

  /** Types a 6-digit authenticator code; the last digit submits it. */
  async enterCode(code: string): Promise<void> {
    await expect(this.page.getByTestId('step-totp')).toBeVisible()
    await this.codeInput.pressSequentially(code)
  }

  /** Switches to a recovery code and submits it. */
  async useRecoveryCode(code: string): Promise<void> {
    await this.page.getByTestId('use-recovery-code').click()
    await this.recoveryCode.fill(code)
    await this.page.getByTestId('recovery-submit').click()
  }
}
