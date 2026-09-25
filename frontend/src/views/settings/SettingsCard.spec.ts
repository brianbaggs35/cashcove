import { Settings } from '@lucide/vue'
import { h } from 'vue'

import { mountWithPlugins } from '@/test/mount'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const action = () => h('button', { 'data-test': 'the-action' }, 'Add')

describe('SettingsCard', () => {
  it('shows its title, explanation and content, with the action beside the title', async () => {
    const { wrapper } = await mountWithPlugins(SettingsCard, {
      width: 1280,
      props: { title: 'Passkeys', subtitle: 'Sign in with your face.', icon: Settings },
      slots: { default: () => 'Content', action, append: () => h('span', 'On') },
    })
    expect(wrapper.find('.v-card-title').text()).toBe('Passkeys')
    expect(wrapper.find('.v-card-subtitle').text()).toBe('Sign in with your face.')
    expect(wrapper.find('.v-avatar').exists()).toBe(true)
    expect(wrapper.find('.v-card-item__append').text()).toBe('OnAdd')
    expect(wrapper.find('[data-test="settings-card-action"]').exists()).toBe(false)
    expect(wrapper.find('.v-card-text').text()).toBe('Content')
  })

  it('moves the action under the explanation on phones', async () => {
    const { wrapper } = await mountWithPlugins(SettingsCard, {
      width: 400,
      props: { title: 'Passkeys' },
      slots: { action },
    })
    expect(wrapper.find('.v-card-subtitle').exists()).toBe(false)
    expect(wrapper.find('.v-avatar').exists()).toBe(false)
    expect(wrapper.find('.v-card-item__append').exists()).toBe(false)
    expect(
      wrapper.find('[data-test="settings-card-action"] [data-test="the-action"]').exists(),
    ).toBe(true)
  })

  it('keeps the append slot beside the title on phones', async () => {
    const { wrapper } = await mountWithPlugins(SettingsCard, {
      width: 400,
      props: { title: 'Two-step verification' },
      slots: { append: () => h('span', 'Off') },
    })
    expect(wrapper.find('.v-card-item__append').text()).toBe('Off')
  })
})
