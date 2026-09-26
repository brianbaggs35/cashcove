import UsernameHint from '@/components/ui/UsernameHint.vue'
import { mountWithPlugins } from '@/test/mount'

describe('UsernameHint', () => {
  it('gives password managers the account, out of sight', async () => {
    const { wrapper } = await mountWithPlugins(UsernameHint, {
      props: { email: 'alex@example.com' },
    })
    expect(wrapper.attributes('hidden')).toBeDefined()
    const input = wrapper.find<HTMLInputElement>('input')
    expect(input.element.value).toBe('alex@example.com')
    expect(input.attributes()).toMatchObject({ type: 'email', autocomplete: 'username' })
    expect(input.attributes('readonly')).toBeDefined()
    expect(wrapper.find(`label[for="${input.attributes('id')}"]`).text()).toBe('Email')
  })
})
