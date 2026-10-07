import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import AiSetupPrompt from '@/views/ai/AiSetupPrompt.vue'

describe('AiSetupPrompt', () => {
  it('says AI is optional and sends an admin to set it up', async () => {
    const { wrapper } = await mountWithPlugins(AiSetupPrompt)

    expect(wrapper.text()).toContain('AI isn’t set up')
    expect(wrapper.text()).toContain('Cashcove works the same without it')
    expect(wrapper.find('[data-test="ai-setup-link"]').attributes('href')).toBe('/settings/ai')
    expect(wrapper.find('[data-test="ai-setup-viewer"]').exists()).toBe(false)
  })

  it('lists what it can do once it’s on, and says each needs AI', async () => {
    const { wrapper } = await mountWithPlugins(AiSetupPrompt)
    const features = wrapper.findAll('[data-test="ai-setup-features"] .v-sheet')

    expect(features.map((feature) => feature.find('.text-title-small').text())).toEqual([
      'Ask about your money',
      'Read a PDF statement',
      'A second opinion on sorting',
      'Find transactions in your own words',
      'Suggest automations',
    ])
    expect(features.map((feature) => feature.find('.v-chip').text())).toEqual(
      Array.from({ length: 5 }, () => 'Needs AI'),
    )
    expect(features[1]!.text()).toContain('you check them and choose the account')
    expect(features[3]!.text()).toContain('“groceries over $50 last month”')
    expect(features[4]!.text()).toContain('which you check before they’re made')
  })

  it('says plainly that these can only be used with AI, and that nothing private is sent', async () => {
    const { wrapper } = await mountWithPlugins(AiSetupPrompt)

    expect(wrapper.find('[data-test="ai-setup-needs"]').text()).toBe(
      'These can only be used with AI.',
    )
    expect(wrapper.text()).toContain(
      'Account numbers, account names and bank names are never sent to an AI.',
    )
  })

  it('tells a viewer to ask an admin', async () => {
    const { wrapper } = await mountWithPlugins(AiSetupPrompt, {
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    })

    expect(wrapper.find('[data-test="ai-setup-link"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ai-setup-viewer"]').text()).toBe(
      'An admin can choose an AI provider in Settings.',
    )
  })
})
