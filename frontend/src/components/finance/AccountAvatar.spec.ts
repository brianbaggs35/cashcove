import AccountAvatar from '@/components/finance/AccountAvatar.vue'
import { mountWithPlugins } from '@/test/mount'

describe('AccountAvatar', () => {
  it('shows the type as an icon in its group color', async () => {
    const { wrapper } = await mountWithPlugins(AccountAvatar, {
      props: { type: 'credit_card', size: 48 },
    })
    expect(wrapper.classes()).toContain('text-secondary')
    expect(wrapper.find('.v-icon').exists()).toBe(true)
    expect(wrapper.attributes('style')).toContain('48px')
  })

  it('is 40 pixels by default', async () => {
    const { wrapper } = await mountWithPlugins(AccountAvatar, { props: { type: 'checking' } })
    expect(wrapper.classes()).toContain('text-primary')
    expect(wrapper.attributes('style')).toContain('40px')
  })
})
