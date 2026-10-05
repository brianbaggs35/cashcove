import { ReceiptText, Repeat } from '@lucide/vue'

import { makePreferences } from '@/test/fixtures'
import { dueReminder, kinds, partOf, partsOf } from '@/views/subscriptions/kinds'

describe('kinds', () => {
  it('names each kind of recurring payment, and gives it its own icon and tab', () => {
    expect(kinds.subscription).toMatchObject({
      tab: 'subscriptions',
      noun: 'subscription',
      title: 'Subscription',
      nouns: 'subscriptions',
      icon: Repeat,
    })
    expect(kinds.bill).toMatchObject({
      tab: 'bills',
      noun: 'bill',
      title: 'Bill',
      nouns: 'bills',
      icon: ReceiptText,
    })
    // Bills are warned about earlier than subscriptions, until Settings says otherwise.
    expect([kinds.subscription.defaultReminderDays, kinds.bill.defaultReminderDays]).toEqual([3, 5])
    expect([kinds.subscription.dueLabel, kinds.bill.dueLabel]).toEqual([
      'Next payment date',
      'Next due date',
    ])
  })

  it('names the parts of a kind’s page for tests', () => {
    expect(partOf('bill', 'add')).toBe('bill-add')
    expect(partsOf('bill', 'error')).toBe('bills-error')
    expect(partOf('subscription', 'card')).toBe('subscription-card')
    expect(partsOf('subscription', 'count')).toBe('subscriptions-count')
  })

  it('reads the reminder of each kind from the alert settings', () => {
    const { alerts } = makePreferences()
    alerts.subscription_due_enabled = true
    alerts.subscription_due_days_before = 2
    alerts.bill_due_enabled = false
    alerts.bill_due_days_before = 9

    expect(dueReminder(alerts, 'subscription')).toEqual({ enabled: true, days: 2 })
    expect(dueReminder(alerts, 'bill')).toEqual({ enabled: false, days: 9 })
  })

  it('does not remind before the settings have loaded, but knows how early it would', () => {
    expect(dueReminder(undefined, 'subscription')).toEqual({ enabled: false, days: 3 })
    expect(dueReminder(undefined, 'bill')).toEqual({ enabled: false, days: 5 })
  })
})
