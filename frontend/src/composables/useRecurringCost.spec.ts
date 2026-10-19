import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'

import type { Subscription } from '@/api/subscriptions'
import { useRecurringCost } from '@/composables/useRecurringCost'
import { useAccountsStore } from '@/stores/accounts'
import { usePreferencesStore } from '@/stores/preferences'
import { checking, makeAccount } from '@/test/finance'
import { makePreferences } from '@/test/fixtures'
import { makeBill, makeSubscription } from '@/test/subscriptions'

describe('useRecurringCost', () => {
  const canadian = makeAccount({ id: 'account-cad', name: 'Canadian card', currency: 'CAD' })

  beforeEach(() => {
    setActivePinia(createPinia())
    usePreferencesStore().saved = makePreferences()
    useAccountsStore().accounts = [checking, canadian]
  })

  it('says what it costs in a month and a year, in words', () => {
    const cost = useRecurringCost(() => makeSubscription())

    expect(cost.value).toBe('about $14.99 a month, $179.88 a year')
  })

  it('spreads a payment that is made less often over the months between', () => {
    const cost = useRecurringCost(() =>
      makeSubscription({ amount: '30.00', frequency: 'bimonthly' }),
    )

    expect(cost.value).toBe('about $15.00 a month, $180.00 a year')
  })

  it('goes by what a bill that changes every time is expected to be', () => {
    const cost = useRecurringCost(() => makeBill({ amount: '90.00', expected_amount: '115.00' }))

    expect(cost.value).toBe('about $115.00 a month, $1,380.00 a year')
  })

  it('writes it in the currency of the account it is paid from', () => {
    const cost = useRecurringCost(() => makeSubscription({ account_id: canadian.id }))

    expect(cost.value).toBe('about CA$14.99 a month, CA$179.88 a year')
  })

  it('has nothing to say until there is one to ask about, and follows the one that is chosen', () => {
    const chosen = ref<Subscription | null>(null)
    const cost = useRecurringCost(() => chosen.value)
    expect(cost.value).toBeNull()

    chosen.value = makeSubscription()
    expect(cost.value).toBe('about $14.99 a month, $179.88 a year')
  })
})
