import { expect, test, totpCode } from '../support'

test.describe('Signing in', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin signs in with a password and lands on Accounts', async ({
    page,
    baseline,
    signInPage,
    shell,
  }) => {
    await signInPage.goto()
    await signInPage.signIn(baseline.users.admin)

    await expect(page).toHaveURL(/\/accounts$/)
    await expect(shell.accountMenu).toHaveAccessibleName(
      `Account menu for ${baseline.users.admin.name}`,
    )
  })

  test('a wrong password is refused', async ({ baseline, signInPage }) => {
    await signInPage.goto()
    await signInPage.signIn({ email: baseline.users.admin.email, password: 'not-my-password' })

    await expect(signInPage.error).toHaveText("That email and password don't match.")
  })

  test('two-step verification asks for the code from the authenticator app', async ({
    page,
    baseline,
    signInPage,
  }) => {
    const jordan = baseline.users.two_step

    await signInPage.goto()
    await signInPage.signIn(jordan)
    await signInPage.enterCode(totpCode(jordan.totp_secret!))

    await expect(page).toHaveURL(/\/accounts$/)
  })

  test('a recovery code works when the phone is lost', async ({ page, baseline, signInPage }) => {
    const jordan = baseline.users.two_step

    await signInPage.goto()
    await signInPage.signIn(jordan)
    await signInPage.useRecoveryCode(jordan.recovery_codes[0]!)

    await expect(page).toHaveURL(/\/accounts$/)
  })

  test("a turned-off account can't sign in", async ({ baseline, signInPage }) => {
    await signInPage.goto()
    await signInPage.signIn(baseline.users.deactivated)

    await expect(signInPage.error).toContainText('Your account is turned off')
  })

  test('signing out goes back to the sign-in page', async ({
    page,
    signInAs,
    shell,
    signInPage,
  }) => {
    await signInAs('viewer')
    await page.goto('/')

    await shell.signOut()

    await expect(signInPage.notice).toHaveText("You've signed out. See you soon.")
  })
})
