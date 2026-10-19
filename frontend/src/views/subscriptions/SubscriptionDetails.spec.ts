import { checking, makeAccount, seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { makeBill, makeSubscription } from '@/test/subscriptions'
import { addDays, todayIso } from '@/utils/dates'
import { formatDateTime } from '@/utils/format'
import SubscriptionDetails from '@/views/subscriptions/SubscriptionDetails.vue'

async function render(
  subscription = makeSubscription(),
  props: Partial<{
    account: ReturnType<typeof makeAccount>
    reminder: { enabled: boolean; days: number }
  }> = {},
) {
  const { wrapper } = await mountWithPlugins(SubscriptionDetails, {
    props: {
      subscription,
      account: checking,
      reminder: { enabled: true, days: 3 },
      ...props,
    },
    beforeMount: () => seedFinance(),
  })
  const text = (name: string) => wrapper.find(`[data-test="${name}"]`).text()
  return { wrapper, text }
}

describe('SubscriptionDetails', () => {
  it('lists what was set up about a subscription', async () => {
    const { text, wrapper } = await render(makeSubscription({ notes: 'Family plan' }))

    expect(text('detail-kind')).toBe('Subscription')
    expect(text('detail-amount')).toBe('$14.99')
    expect(text('detail-frequency')).toBe('Monthly')
    expect(text('detail-account')).toBe('Everyday checking Harbor Credit Union')
    expect(wrapper.find('[data-test="category-chip"]').text()).toContain('Groceries')
    expect(text('detail-payee')).toContain('Streamflix')
    expect(text('detail-payee')).toContain('linked automatically')
    expect(text('detail-notes')).toBe('Family plan')
    // In the time zone of whoever reads it.
    expect(text('detail-created')).toBe(formatDateTime('2026-09-01T12:00:00Z'))
    expect(text('detail-updated')).toBe(formatDateTime('2026-09-01T12:00:00Z'))
  })

  it('calls a bill a bill, and says its amount is an estimate that recent payments average out', async () => {
    const { text, wrapper } = await render(
      makeBill({ typical_amount: '111.92', category_id: null }),
    )

    expect(text('detail-kind')).toBe('Bill')
    expect(wrapper.text()).toContain('Estimated amount')
    expect(text('detail-amount')).toContain('$96.40')
    expect(text('detail-amount')).toContain(
      'Different every time · recent payments average $111.92',
    )
    expect(wrapper.find('[data-test="category-chip"]').text()).toBe('Uncategorized')
  })

  it('has nothing to average for a bill with no payments yet', async () => {
    const { text } = await render(makeBill({ typical_amount: null }))

    expect(text('detail-amount')).toContain('Different every time')
    expect(text('detail-amount')).not.toContain('average')
  })

  it('leaves out notes there are none of, and the bank of an account with none', async () => {
    const { wrapper, text } = await render(makeSubscription(), {
      account: makeAccount({ institution: null }),
    })

    expect(wrapper.find('[data-test="detail-notes"]').exists()).toBe(false)
    expect(text('detail-account')).toBe('Everyday checking')
  })

  it('says when the account is not there any more', async () => {
    const { text } = await render(makeSubscription(), { account: undefined })

    expect(text('detail-account')).toBe('Account unavailable')
  })

  it.each([
    [{ enabled: true, days: 3 }, '3 days before it is due'],
    [{ enabled: true, days: 1 }, '1 day before it is due'],
    [{ enabled: true, days: 0 }, 'On the day it is due'],
    [{ enabled: false, days: 3 }, 'Off'],
  ])('says what the reminder is, for %j', async (reminder, said) => {
    const { text, wrapper } = await render(makeSubscription(), { reminder })

    expect(text('detail-reminder')).toContain(said)
    expect(wrapper.find('[data-test="detail-reminder"] a').attributes('href')).toBe(
      '/settings/alerts',
    )
  })

  it('says new payments are not linked while it is paused', async () => {
    const { text } = await render(makeSubscription({ active: false }))

    expect(text('detail-payee')).toContain('Paused, so new payments are not linked.')
  })

  describe('when it ends', () => {
    const inDays = (days: number) => addDays(todayIso(), days)

    it('has nothing about an end for one that carries on', async () => {
      const { wrapper } = await render()
      expect(wrapper.find('[data-test="detail-ends"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="detail-cancelled"]').exists()).toBe(false)
    })

    it('says when one that is to end does, and that nothing is expected from then', async () => {
      const { text, wrapper } = await render(makeSubscription({ ends_on: '2999-03-01' }))

      expect(
        wrapper.find('[data-test="detail-ends"]').element.previousElementSibling?.textContent,
      ).toBe('Ends')
      expect(text('detail-ends')).toContain('Mar 1, 2999')
      expect(text('detail-ends')).toContain('No payment is expected on or after this day.')
      expect(wrapper.find('[data-test="detail-cancelled"]').exists()).toBe(false)
    })

    it('says when one has ended, and when it was cancelled', async () => {
      const { text, wrapper } = await render(
        makeSubscription({ ends_on: inDays(-2), cancelled_on: '2026-10-01' }),
      )

      expect(
        wrapper.find('[data-test="detail-ends"]').element.previousElementSibling?.textContent,
      ).toBe('Ended')
      expect(text('detail-ends')).toContain('Everything it tracked stays here.')
      expect(text('detail-cancelled')).toBe('Oct 1, 2026')
    })
  })
})
