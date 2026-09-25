import { mountSection } from '@/test/settings'
import SecuritySection from '@/views/settings/SecuritySection.vue'
import UsersSection from '@/views/settings/UsersSection.vue'

describe('UsersSection', () => {
  it('previews roles and explains that sign-in comes next', async () => {
    const { wrapper } = await mountSection(UsersSection)
    expect(wrapper.text()).toContain('Sign-in comes next')
    for (const role of ['Owner', 'Member', 'Viewer']) expect(wrapper.text()).toContain(role)
    wrapper.unmount()
  })
})

describe('SecuritySection', () => {
  it('lists protections in place and those coming with sign-in', async () => {
    const { wrapper } = await mountSection(SecuritySection)
    expect(wrapper.text()).toContain('Strict Content Security Policy')
    expect(wrapper.text()).toContain('Passkeys and two-factor sign-in')
    wrapper.unmount()
  })
})
