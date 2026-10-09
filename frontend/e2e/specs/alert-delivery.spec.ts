import { expect, signInFiles, test } from '../support'

const WEBHOOK = 'https://discord.com/api/webhooks/123456789012345678/e2e-secret-token'

test.describe('alert delivery settings', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test.describe('as an admin', () => {
    test.use({ storageState: signInFiles.admin })

    test('saves Discord and SMTP settings without returning credentials', async ({
      page,
      apiAs,
    }) => {
      await page.goto('/settings/alerts')
      await expect(page.getByTestId('alert-delivery-settings')).toBeVisible()
      await expect(page.getByTestId('alert-delivery-loading')).toHaveCount(0)

      await page.getByTestId('alert-discord-enabled').locator('input').check()
      await page.getByTestId('alert-discord-webhook').locator('input').fill(WEBHOOK)
      await page.getByTestId('alert-discord-save').click()
      await expect(page.getByTestId('alert-discord-status')).toHaveText('On')

      await page.getByTestId('alert-smtp-host').locator('input').fill('smtp.example.test')
      await page.getByTestId('alert-smtp-from').locator('input').fill('alerts@example.com')
      await page.getByTestId('alert-smtp-to').locator('input').fill('alex@example.com')
      await page.getByTestId('alert-smtp-enabled').locator('input').check()
      await page.getByTestId('alert-smtp-authentication').locator('input').check()
      await page.getByTestId('alert-smtp-username').locator('input').fill('e2e-smtp-user')
      await page
        .getByTestId('alert-smtp-password')
        .locator('input')
        .fill('e2e-smtp-password-secret')
      await page.getByTestId('alert-smtp-save').click()
      await expect(page.getByTestId('alert-smtp-status')).toHaveText('On')
      await expect(page.getByTestId('alert-smtp-password').locator('input')).toHaveValue('')

      const saved = await (await apiAs('admin')).get<Record<string, unknown>>('/alerts/settings')
      expect(saved).toMatchObject({
        discord_configured: true,
        discord_webhook_set: true,
        smtp_configured: true,
        smtp_username_set: true,
        smtp_password_set: true,
      })
      expect(JSON.stringify(saved)).not.toContain(WEBHOOK)
      expect(JSON.stringify(saved)).not.toContain('e2e-smtp-user')
      expect(JSON.stringify(saved)).not.toContain('e2e-smtp-password-secret')
    })

    test('reports an SMTP connection error in the form', async ({ page }) => {
      await page.goto('/settings/alerts')
      await expect(page.getByTestId('alert-delivery-settings')).toBeVisible()
      await expect(page.getByTestId('alert-delivery-loading')).toHaveCount(0)

      await page.getByTestId('alert-smtp-host').locator('input').fill('127.0.0.1')
      await page.getByTestId('alert-smtp-port').locator('input').fill('1')
      await page.getByTestId('alert-smtp-security').locator('.v-field').click()
      await page.getByRole('option', { name: 'None' }).click()
      await page.getByTestId('alert-smtp-from').locator('input').fill('alerts@example.com')
      await page.getByTestId('alert-smtp-to').locator('input').fill('alex@example.com')
      await page.getByTestId('alert-smtp-test').click()

      await expect(page.getByTestId('alert-smtp-test-result')).toContainText(
        "Couldn't connect to the SMTP server",
      )
    })
  })
})
