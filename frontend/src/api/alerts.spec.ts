import * as client from '@/api/client'
import {
  fetchAlertDeliverySettings,
  saveAlertDeliverySettings,
  testDiscordWebhook,
  testSmtpConnection,
  type AlertDeliverySettings,
} from '@/api/alerts'

const current: AlertDeliverySettings = {
  discord_enabled: false,
  discord_configured: false,
  discord_webhook_set: false,
  smtp_enabled: false,
  smtp_configured: false,
  smtp_host: null,
  smtp_port: 587,
  smtp_security: 'starttls',
  smtp_username_set: false,
  smtp_password_set: false,
  smtp_from: null,
  smtp_to: null,
}

describe('alert delivery API', () => {
  it('gets the saved delivery settings', async () => {
    const get = vi.spyOn(client, 'apiGet').mockResolvedValue(current)

    await expect(fetchAlertDeliverySettings()).resolves.toEqual(current)
    expect(get).toHaveBeenCalledWith('/alerts/settings')
  })

  it('patches only the changed channel settings', async () => {
    const patch = { discord_enabled: true, discord_webhook_url: 'https://discord.com/hook' }
    const update = vi.spyOn(client, 'apiPatch').mockResolvedValue(current)

    await saveAlertDeliverySettings(patch)
    expect(update).toHaveBeenCalledWith('/alerts/settings', patch)
  })

  it('tests SMTP with the values currently in the form', async () => {
    const form = { smtp_host: 'smtp.example.test', smtp_port: 587 }
    const post = vi.spyOn(client, 'apiPost').mockResolvedValue({ ok: true, message: 'Sent.' })

    await testSmtpConnection(form)
    expect(post).toHaveBeenCalledWith('/alerts/smtp/test', form)
  })

  it('tests a Discord webhook with the values currently in the form', async () => {
    const form = { discord_webhook_url: 'https://discord.com/api/webhooks/123/secret' }
    const post = vi.spyOn(client, 'apiPost').mockResolvedValue({ ok: true, message: 'Sent.' })

    await testDiscordWebhook(form)
    expect(post).toHaveBeenCalledWith('/alerts/discord/test', form)
  })
})
