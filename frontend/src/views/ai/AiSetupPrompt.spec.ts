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
