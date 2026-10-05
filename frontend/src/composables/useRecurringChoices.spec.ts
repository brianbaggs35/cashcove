import { createPinia, setActivePinia } from 'pinia'

import { useRecurringChoices } from '@/composables/useRecurringChoices'
import { useAccountsStore } from '@/stores/accounts'
import { usePreferencesStore } from '@/stores/preferences'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { makePreferences } from '@/test/fixtures'
import { checking, makeAccount } from '@/test/finance'
import { makeBill, makeSubscription } from '@/test/subscriptions'

describe('useRecurringChoices', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    usePreferencesStore().saved = makePreferences()
    useAccountsStore().accounts = [checking]
  })

  it('groups the subscriptions and the bills being tracked, saying how often and how much', () => {
    const store = useSubscriptionsStore()
    store.subscriptions = [
      makeSubscription(),
      makeSubscription({ id: 'subscription-old', name: 'Old gym', active: false }),
    ]
    store.bills = [makeBill({ amount: '96.40', expected_amount: '104.00', frequency: 'quarterly' })]

    expect(useRecurringChoices().choices()).toEqual([
      { type: 'subheader', title: 'Subscriptions' },
      {
        value: 'subscription-streamflix',
        title: 'Streamflix',
        props: { subtitle: 'Monthly · $14.99' },
      },
      { type: 'subheader', title: 'Bills' },
      {
        value: 'bill-power',
        title: 'City Power',
        props: { subtitle: 'Every three months · $104.00' },
      },
    ])
  })

  it('still offers a paused one when it is the one chosen now', () => {
    const store = useSubscriptionsStore()
    store.bills = [makeBill({ active: false })]

    const { choices } = useRecurringChoices()

    expect(choices()).toEqual([])
    expect(choices('bill-power').map((choice) => choice.title)).toEqual(['Bills', 'City Power'])
  })

  it('writes an amount in the currency of the account it is paid from', () => {
    useAccountsStore().accounts = [makeAccount({ id: checking.id, currency: 'EUR' })]
    useSubscriptionsStore().bills = [
      makeBill({ account_id: checking.id, expected_amount: '50.00' }),
    ]

    const choice = useRecurringChoices().choices()[1]!

    expect(choice).toHaveProperty('props.subtitle', expect.stringContaining('€'))
  })
})
