import { mountWithPlugins } from '@/test/mount'
import AiPrivacyNotice from '@/views/ai/AiPrivacyNotice.vue'

describe('AiPrivacyNotice', () => {
  it('says in a line that account information is never sent, with the detail a click away', async () => {
    const { wrapper } = await mountWithPlugins(AiPrivacyNotice)

    expect(wrapper.text()).toContain(
      'Account numbers, account names and bank names are never sent to the AI.',
    )
    expect(wrapper.find('[data-test="ai-privacy-guard"]').exists()).toBe(false)
    const toggle = wrapper.find('[data-test="ai-privacy-toggle"]')
    expect(toggle.text()).toBe('What is shared?')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    await toggle.trigger('click')

    expect(toggle.text()).toBe('Hide details')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('What the AI is told')
    expect(wrapper.text()).toContain('the accounts you name are found by Cashcove')
    expect(wrapper.text()).toContain('For a PDF statement, only its transaction lines')
    expect(wrapper.text()).toContain('To suggest an automation, the payees you put in the same')
    expect(wrapper.text()).toContain('What it is never told')
    expect(wrapper.text()).toContain('The names of your accounts, and the names of your banks.')
    expect(wrapper.text()).toContain('Your API key, which stays on the server')
    expect(wrapper.find('[data-test="ai-privacy-guard"]').text()).toContain(
      'the request is refused and nothing is sent',
    )

    await toggle.trigger('click')
    expect(toggle.text()).toBe('What is shared?')
  })

  it('lists everything at once in its full form, with no line or button', async () => {
    const { wrapper } = await mountWithPlugins(AiPrivacyNotice, { props: { full: true } })

    expect(wrapper.find('[data-test="ai-privacy-toggle"]').exists()).toBe(false)
    expect(wrapper.find('.v-alert').exists()).toBe(false)
    expect(wrapper.text()).toContain('What the AI is told')
    expect(wrapper.text()).toContain('What it is never told')
    expect(wrapper.text()).toContain('Balances, bank connections and sign-ins.')
    expect(wrapper.text()).toContain('The AI only ever suggests')
  })
})
