import { flushPromises } from '@vue/test-utils'

import * as account from '@/api/account'
import * as passkeys from '@/auth/passkeys'
import { makeSessionState, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import ActivityCard from '@/views/settings/ActivityCard.vue'
import DevicesCard from '@/views/settings/security/DevicesCard.vue'
import PasskeysCard from '@/views/settings/security/PasskeysCard.vue'
import TwoStepCard from '@/views/settings/security/TwoStepCard.vue'
import SecuritySection from '@/views/settings/SecuritySection.vue'

beforeEach(() => {
  vi.spyOn(account, 'fetchPasskeys').mockResolvedValue([])
  vi.spyOn(account, 'fetchSessions').mockResolvedValue([])
  vi.spyOn(passkeys, 'signalCurrentPasskeys').mockResolvedValue(undefined)
})

describe('SecuritySection', () => {
  it('gathers everything about signing in, and refreshes the activity after a change', async () => {
    const activity = vi.spyOn(account, 'fetchActivity').mockResolvedValue([])
    const { wrapper } = await mountWithPlugins(SecuritySection, { session: makeSessionState() })
    await flushPromises()
    expect(wrapper.find('[data-test="security-summary-title"]').exists()).toBe(true)
    expect(wrapper.findComponent(ActivityCard).exists()).toBe(true)
    expect(activity).toHaveBeenCalledOnce()

    for (const card of [PasskeysCard, TwoStepCard, DevicesCard]) {
      wrapper.findComponent(card).vm.$emit('changed')
    }
    await flushPromises()
    expect(activity).toHaveBeenCalledTimes(4)
  })

  it('always explains the protection built in', async () => {
    const { wrapper } = await mountWithPlugins(SecuritySection, { session: signedOutState() })
    expect(wrapper.text()).toContain('Built into Cashcove')
    expect(wrapper.text()).toContain('Passwords are hashed with Argon2id')
    expect(wrapper.find('[data-test="security-summary-title"]').exists()).toBe(false)
  })
})
