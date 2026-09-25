import { expect, expectAccessible, TABS, test } from '../support'

const SETTINGS = [
  'general',
  'users',
  'alerts',
  'sync',
  'account',
  'security',
  'appearance',
  'system',
]

/** Every page of the signed-in app. */
const PAGES = [
  ...Object.keys(TABS)
    .filter((tab) => tab !== 'settings')
    .map((tab) => `/${tab}`),
  ...SETTINGS.map((section) => `/settings/${section}`),
]

test.describe('Accessibility', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(`in the ${colorScheme} theme`, () => {
      // The app follows the device's theme until someone picks one.
      test.use({ colorScheme })

      test('the sign-in page', async ({ signInPage, baseline }) => {
        await signInPage.goto()
        await signInPage.email.fill(baseline.users.admin.email)
        await signInPage.password.fill(baseline.users.admin.password)

        await expectAccessible(signInPage.page)
      })

      test('the invitation page', async ({ page, baseline }) => {
        await page.goto(baseline.invitations.pending.link)
        await expect(page.getByTestId('invite-email')).toBeVisible()

        await expectAccessible(page)
      })

      test('the first-run setup wizard', async ({ page, baseline }) => {
        await baseline.freshInstall()
        await page.goto('/welcome')
        await expect(page.getByTestId('welcome-start')).toBeVisible()

        await expectAccessible(page)
      })

      test('every page an admin sees', async ({ page, signInAs }) => {
        test.slow()
        await signInAs('admin')

        for (const path of PAGES) {
          await test.step(path, async () => {
            await page.goto(path)
            await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

            await expectAccessible(page)
          })
        }
      })

      test('the settings a viewer sees', async ({ page, signInAs }) => {
        await signInAs('viewer')

        for (const section of ['general', 'users']) {
          await test.step(section, async () => {
            await page.goto(`/settings/${section}`)
            await expect(page.getByTestId('read-only-notice')).toBeVisible()

            await expectAccessible(page)
          })
        }
      })

      test('the account menu and the invite dialog', async ({ page, signInAs, shell }) => {
        await signInAs('admin')
        await page.goto('/settings/users')

        await page.getByTestId('invite-open').click()
        await expectAccessible(page, { include: '.v-overlay--active' })
        await page.keyboard.press('Escape')

        await shell.accountMenu.click()
        await expectAccessible(page, { include: '.v-overlay--active' })
      })
    })
  }
})
