import { apiGet, apiPatch, apiPost } from '@/api/client'

export type SmtpSecurity = 'starttls' | 'ssl' | 'none'

/** The saved channel state. Webhook URLs and SMTP credentials are never returned. */
export interface AlertDeliverySettings {
  discord_enabled: boolean
  discord_configured: boolean
  discord_webhook_set: boolean
  smtp_enabled: boolean
  smtp_configured: boolean
  smtp_host: string | null
  smtp_port: number
  smtp_security: SmtpSecurity
  smtp_username_set: boolean
  smtp_password_set: boolean
  smtp_from: string | null
  smtp_to: string | null
}

/** Only supplied settings change; leave secret fields out to keep what is already saved. */
export interface AlertSettingsPatch {
  discord_enabled?: boolean
  discord_webhook_url?: string
  clear_discord_webhook?: boolean
  smtp_enabled?: boolean
  smtp_host?: string | null
  smtp_port?: number
  smtp_security?: SmtpSecurity
  smtp_username?: string
  smtp_password?: string
  clear_smtp_credentials?: boolean
  smtp_from?: string | null
  smtp_to?: string | null
}

export interface AlertTestResult {
  ok: boolean
  message: string
}

export const fetchAlertDeliverySettings = () => apiGet<AlertDeliverySettings>('/alerts/settings')

export const saveAlertDeliverySettings = (patch: AlertSettingsPatch) =>
  apiPatch<AlertDeliverySettings>('/alerts/settings', patch)

export const testSmtpConnection = (settings: AlertSettingsPatch) =>
  apiPost<AlertTestResult>('/alerts/smtp/test', settings)

export const testDiscordWebhook = (settings: AlertSettingsPatch) =>
  apiPost<AlertTestResult>('/alerts/discord/test', settings)
