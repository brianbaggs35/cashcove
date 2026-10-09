import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/alerts'
import { ApiError } from '@/api/client'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AlertDeliverySection from '@/views/settings/AlertDeliverySection.vue'

const off: api.AlertDeliverySettings = {
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

const configured: api.AlertDeliverySettings = {
  ...off,
  discord_enabled: true,
  discord_configured: true,
  discord_webhook_set: true,
  smtp_enabled: true,
  smtp_configured: true,
  smtp_host: 'smtp.example.test',
  smtp_security: 'ssl',
  smtp_username_set: true,
  smtp_password_set: true,
  smtp_from: 'alerts@example.com',
  smtp_to: 'alex@example.com',
}

async function render({
  settings = off,
  role = 'admin',
}: {
  settings?: api.AlertDeliverySettings
  role?: 'admin' | 'viewer'
} = {}) {
  vi.spyOn(api, 'fetchAlertDeliverySettings').mockResolvedValue(settings)
  const mounted = await mountWithPlugins(AlertDeliverySection, {
    session: makeSessionState({ user: makeUser({ role }) }),
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const type = async (name: string, value: string) => {
    await find(name).find('input').setValue(value)
  }
  return { ...mounted, find, type }
}

describe('AlertDeliverySection', () => {
  afterEach(() => vi.restoreAllMocks())

  it('shows separate Discord and email sections without revealing saved secrets', async () => {
    const { wrapper, find } = await render({ settings: configured })

    expect(wrapper.text()).toContain('Discord')
    expect(wrapper.text()).toContain('Email')
    expect(find('alert-discord-status').text()).toBe('On')
    expect(find('alert-smtp-status').text()).toBe('On')
    expect(find('alert-discord-webhook').find('input').element.value).toBe('')
    expect(find('alert-smtp-username').find('input').element.value).toBe('')
    expect(find('alert-smtp-password').find('input').element.value).toBe('')
    expect(find('alert-discord-saved').text()).toContain('saved encrypted')
    expect(find('alert-smtp-credentials-saved').text()).toContain('saved encrypted')
    expect(wrapper.text()).not.toContain('secret')
  })

  it('saves a new Discord webhook and keeps the URL out of the response form', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(configured)
    const { find, type } = await render()
    const webhook = 'https://discord.com/api/webhooks/123456789/discord-secret-token'

    await type('alert-discord-webhook', webhook)
    await find('alert-discord-enabled').find('input').setValue(true)
    await find('alert-discord-form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      discord_enabled: true,
      discord_webhook_url: webhook,
    })
    expect(find('alert-discord-webhook').find('input').element.value).toBe('')
    expect(find('alert-discord-status').text()).toBe('On')
  })

  it('keeps an existing webhook when its input is blank and can explicitly remove it', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(configured)
    const { find } = await render({ settings: configured })

    await find('alert-discord-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({ discord_enabled: true })

    await find('alert-discord-remove').trigger('click')
    expect(find('alert-discord-remove-pending').exists()).toBe(true)
    await find('alert-discord-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({
      discord_enabled: false,
      clear_discord_webhook: true,
    })
  })

  it('tests the saved Discord webhook and shows provider feedback', async () => {
    const test = vi
      .spyOn(api, 'testDiscordWebhook')
      .mockResolvedValueOnce({ ok: true, message: 'Test message sent to Discord.' })
      .mockResolvedValueOnce({ ok: false, message: 'Discord rejected the test message.' })
    const { find } = await render({ settings: configured })

    await find('alert-discord-test').trigger('click')
    await flushPromises()
    expect(test).toHaveBeenCalledWith({ discord_enabled: true })
    expect(find('alert-discord-test-result').text()).toContain('sent to Discord')
    await find('alert-discord-test').trigger('click')
    await flushPromises()
    expect(find('alert-discord-test-result').text()).toContain('Discord rejected')
  })

  it('saves SMTP details and only sends credentials when changed', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(configured)
    const { find, type } = await render()
    await type('alert-smtp-host', 'smtp.example.test')
    await type('alert-smtp-port', '465')
    await type('alert-smtp-from', 'alerts@example.com')
    await type('alert-smtp-to', 'alex@example.com')
    await find('alert-smtp-enabled').find('input').setValue(true)
    await find('alert-smtp-authentication').find('input').setValue(true)
    await type('alert-smtp-username', 'smtp-user')
    await type('alert-smtp-password', 'smtp-password-secret')
    await find('alert-smtp-form').trigger('submit')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      smtp_enabled: true,
      smtp_host: 'smtp.example.test',
      smtp_port: 465,
      smtp_security: 'starttls',
      smtp_from: 'alerts@example.com',
      smtp_to: 'alex@example.com',
      smtp_username: 'smtp-user',
      smtp_password: 'smtp-password-secret',
    })
  })

  it('keeps saved SMTP credentials blank and removes them when authentication is turned off', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(configured)
    const { find } = await render({ settings: configured })

    await find('alert-smtp-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({
      smtp_enabled: true,
      smtp_host: 'smtp.example.test',
      smtp_port: 587,
      smtp_security: 'ssl',
      smtp_from: 'alerts@example.com',
      smtp_to: 'alex@example.com',
    })

    await find('alert-smtp-authentication').find('input').setValue(false)
    await find('alert-smtp-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({
      smtp_enabled: true,
      smtp_host: 'smtp.example.test',
      smtp_port: 587,
      smtp_security: 'ssl',
      smtp_from: 'alerts@example.com',
      smtp_to: 'alex@example.com',
      clear_smtp_credentials: true,
    })
  })

  it('submits only changed SMTP credentials and does not clear an empty configuration', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(configured)
    const saved = await render({ settings: configured })
    await saved.type('alert-smtp-username', 'replacement-user')
    await saved.find('alert-smtp-save').trigger('click')
    await flushPromises()
    expect(save).toHaveBeenLastCalledWith({
      smtp_enabled: true,
      smtp_host: 'smtp.example.test',
      smtp_port: 587,
      smtp_security: 'ssl',
      smtp_from: 'alerts@example.com',
      smtp_to: 'alex@example.com',
      smtp_username: 'replacement-user',
    })

    const fresh = await render()
    const freshSave = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(off)
    await fresh.find('alert-smtp-save').trigger('click')
    await flushPromises()
    expect(freshSave).toHaveBeenLastCalledWith({
      smtp_enabled: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_security: 'starttls',
      smtp_from: null,
      smtp_to: null,
    })
  })

  it('clears credentials typed into an unsaved authentication form when it is switched off', async () => {
    const save = vi.spyOn(api, 'saveAlertDeliverySettings').mockResolvedValue(off)
    const { find, type } = await render()

    await find('alert-smtp-authentication').find('input').setValue(true)
    await type('alert-smtp-password', 'temporary-password')
    await find('alert-smtp-authentication').find('input').setValue(false)
    await find('alert-smtp-save').trigger('click')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      smtp_enabled: false,
      smtp_host: null,
      smtp_port: 587,
      smtp_security: 'starttls',
      smtp_from: null,
      smtp_to: null,
      clear_smtp_credentials: true,
    })
  })

  it('tests SMTP and distinguishes a test response from an API error', async () => {
    const test = vi
      .spyOn(api, 'testSmtpConnection')
      .mockResolvedValueOnce({ ok: true, message: 'Test email sent to alex@example.com.' })
      .mockResolvedValueOnce({
        ok: false,
        message: 'The SMTP server rejected the username or password.',
      })
    const { find } = await render({ settings: configured })

    await find('alert-smtp-test').trigger('click')
    await flushPromises()
    expect(find('alert-smtp-test-result').text()).toContain('Test email sent')
    await find('alert-smtp-test').trigger('click')
    await flushPromises()
    expect(find('alert-smtp-test-result').text()).toContain('rejected the username')
    expect(test).toHaveBeenCalledTimes(2)
  })

  it('requires a TLS connection when SMTP authentication is on', async () => {
    vi.spyOn(api, 'testSmtpConnection').mockResolvedValue({
      ok: true,
      message: 'Test email sent to alex@example.com.',
    })
    const { wrapper, find } = await render({ settings: configured })
    const security = wrapper.findComponent({ name: 'VSelect' })

    await security.setValue('none')
    expect(find('alert-smtp-auth-tls').exists()).toBe(true)
    expect(find('alert-smtp-test').attributes('disabled')).toBeDefined()

    await find('alert-smtp-authentication').find('input').setValue(false)
    expect(find('alert-smtp-auth-tls').exists()).toBe(false)
    expect(find('alert-smtp-test').attributes('disabled')).toBeUndefined()
    await find('alert-smtp-test').trigger('click')
    await flushPromises()
    expect(find('alert-smtp-test-result').text()).toContain('Test email sent')
  })

  it('shows settings errors and retries loading', async () => {
    vi.spyOn(api, 'fetchAlertDeliverySettings')
      .mockRejectedValueOnce(new ApiError(503, 'Server unavailable.'))
      .mockResolvedValueOnce(off)
    const mounted = await mountWithPlugins(AlertDeliverySection)
    await flushPromises()

    expect(mounted.wrapper.find('[data-test="alert-delivery-error"]').text()).toContain(
      "Couldn't load alert delivery settings",
    )
    await mounted.wrapper.find('[data-test="alert-delivery-retry"]').trigger('click')
    await flushPromises()
    expect(mounted.wrapper.find('[data-test="alert-delivery-error"]').exists()).toBe(false)
    expect(mounted.wrapper.find('[data-test="alert-discord-status"]').text()).toBe('Off')
  })

  it('shows a skeleton while settings are loading', async () => {
    vi.spyOn(api, 'fetchAlertDeliverySettings').mockReturnValue(new Promise(() => undefined))
    const { wrapper } = await mountWithPlugins(AlertDeliverySection)

    expect(wrapper.find('[data-test="alert-delivery-loading"]').exists()).toBe(true)
  })

  it('keeps delivery settings read-only for viewers', async () => {
    const { find } = await render({ settings: configured, role: 'viewer' })

    expect(find('read-only-notice').exists()).toBe(true)
    expect(find('alert-discord-save').exists()).toBe(false)
    expect(find('alert-smtp-save').exists()).toBe(false)
    expect(find('alert-discord-enabled').find('input').attributes('disabled')).toBeDefined()
    expect(find('alert-smtp-enabled').find('input').attributes('disabled')).toBeDefined()
  })

  it('shows save and test errors without hiding the form', async () => {
    vi.spyOn(api, 'saveAlertDeliverySettings').mockRejectedValue(
      new ApiError(422, 'Enter the SMTP host.'),
    )
    vi.spyOn(api, 'testDiscordWebhook').mockRejectedValue(new Error('Discord is unreachable.'))
    const { find } = await render({ settings: configured })

    await find('alert-discord-test').trigger('click')
    await flushPromises()
    expect(find('alert-discord-error').text()).toContain('Discord is unreachable')
    await find('alert-discord-save').trigger('click')
    await flushPromises()
    expect(find('alert-discord-error').text()).toContain('Enter the SMTP host')
    await find('alert-smtp-save').trigger('click')
    await flushPromises()
    expect(find('alert-smtp-error').text()).toContain('Enter the SMTP host')
  })
})
