import OriginNotice from '@/components/auth/OriginNotice.vue'
import { makeSessionState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'

describe('OriginNotice', () => {
  it('stays hidden at the address Cashcove is set up for', async () => {
    const { wrapper } = await mountWithPlugins(OriginNotice)
    expect(wrapper.find('[data-test="origin-notice"]').exists()).toBe(false)
  })

  it('links to the same page at the right address', async () => {
    window.history.replaceState(null, '', '/settings/security?tab=1')
    const { wrapper } = await mountWithPlugins(OriginNotice, {
      session: makeSessionState({ origin: 'https://cashcove.example.com' }),
    })
    const notice = wrapper.find('[data-test="origin-notice"]')
    expect(notice.text()).toContain('Cashcove is set up for https://cashcove.example.com')
    expect(notice.find('a').attributes('href')).toBe(
      'https://cashcove.example.com/settings/security?tab=1',
    )
    window.history.replaceState(null, '', '/')
  })
})
