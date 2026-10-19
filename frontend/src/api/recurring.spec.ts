import * as bills from '@/api/bills'
import { recurringApi } from '@/api/recurring'
import * as subscriptions from '@/api/subscriptions'
import type { SubscriptionInput } from '@/api/subscriptions'
import { makeOverview, makeSubscription } from '@/test/subscriptions'

const input: SubscriptionInput = {
  name: 'Streamflix',
  payee: 'Streamflix',
  amount: '14.99',
  amount_varies: false,
  frequency: 'monthly',
  account_id: 'account-checking',
  next_due_date: '2026-10-15',
  ends_on: null,
  category_id: null,
  notes: null,
  seed_transaction_id: null,
}
const cancelled = { cancelled_on: '2026-10-19', ends_on: '2026-11-05' }
const reactivated = { next_due_date: '2027-01-05', today: '2026-12-20' }

describe('recurringApi', () => {
  it('makes every call for a subscription to the subscriptions API', async () => {
    const item = makeSubscription()
    const full = makeOverview(item)
    const calls = {
      fetch: vi.spyOn(subscriptions, 'fetchSubscriptions').mockResolvedValue([item]),
      overview: vi.spyOn(subscriptions, 'fetchSubscriptionOverview').mockResolvedValue(full),
      create: vi.spyOn(subscriptions, 'createSubscription').mockResolvedValue(item),
      update: vi.spyOn(subscriptions, 'updateSubscription').mockResolvedValue(item),
      remove: vi.spyOn(subscriptions, 'deleteSubscription').mockResolvedValue(undefined),
      link: vi
        .spyOn(subscriptions, 'linkSubscriptionPayments')
        .mockResolvedValue({ count: 1, subscription: item }),
      unlink: vi.spyOn(subscriptions, 'unlinkSubscriptionPayment').mockResolvedValue(item),
      cancel: vi.spyOn(subscriptions, 'cancelSubscription').mockResolvedValue(item),
      reactivate: vi.spyOn(subscriptions, 'reactivateSubscription').mockResolvedValue(item),
    }
    const api = recurringApi('subscription')

    await api.fetch(true)
    await api.overview('s1', '2026-10-14')
    await api.create(input)
    await api.update('s1', { active: false })
    await api.remove('s1')
    await api.link('s1', ['t1'])
    await api.unlink('s1', 't1')
    await api.cancel('s1', cancelled)
    await api.reactivate('s1', reactivated)

    expect(calls.fetch).toHaveBeenCalledWith(true)
    expect(calls.overview).toHaveBeenCalledWith('s1', '2026-10-14')
    expect(calls.create).toHaveBeenCalledWith(input)
    expect(calls.update).toHaveBeenCalledWith('s1', { active: false })
    expect(calls.remove).toHaveBeenCalledWith('s1')
    expect(calls.link).toHaveBeenCalledWith('s1', ['t1'])
    expect(calls.unlink).toHaveBeenCalledWith('s1', 't1')
    expect(calls.cancel).toHaveBeenCalledWith('s1', cancelled)
    expect(calls.reactivate).toHaveBeenCalledWith('s1', reactivated)
  })

  it('makes every call for a bill to the bills API', async () => {
    const item = makeSubscription({ kind: 'bill' })
    const full = makeOverview(item)
    const calls = {
      fetch: vi.spyOn(bills, 'fetchBills').mockResolvedValue([item]),
      overview: vi.spyOn(bills, 'fetchBillOverview').mockResolvedValue(full),
      create: vi.spyOn(bills, 'createBill').mockResolvedValue(item),
      update: vi.spyOn(bills, 'updateBill').mockResolvedValue(item),
      remove: vi.spyOn(bills, 'deleteBill').mockResolvedValue(undefined),
      link: vi.spyOn(bills, 'linkBillPayments').mockResolvedValue({ count: 1, subscription: item }),
      unlink: vi.spyOn(bills, 'unlinkBillPayment').mockResolvedValue(item),
      cancel: vi.spyOn(bills, 'cancelBill').mockResolvedValue(item),
      reactivate: vi.spyOn(bills, 'reactivateBill').mockResolvedValue(item),
    }
    const api = recurringApi('bill')

    await api.fetch(false)
    await api.overview('b1', '2026-10-14')
    await api.create(input)
    await api.update('b1', { active: true })
    await api.remove('b1')
    await api.link('b1', ['t1', 't2'])
    await api.unlink('b1', 't2')
    await api.cancel('b1', cancelled)
    await api.reactivate('b1', reactivated)

    expect(calls.fetch).toHaveBeenCalledWith(false)
    expect(calls.overview).toHaveBeenCalledWith('b1', '2026-10-14')
    expect(calls.create).toHaveBeenCalledWith(input)
    expect(calls.update).toHaveBeenCalledWith('b1', { active: true })
    expect(calls.remove).toHaveBeenCalledWith('b1')
    expect(calls.link).toHaveBeenCalledWith('b1', ['t1', 't2'])
    expect(calls.unlink).toHaveBeenCalledWith('b1', 't2')
    expect(calls.cancel).toHaveBeenCalledWith('b1', cancelled)
    expect(calls.reactivate).toHaveBeenCalledWith('b1', reactivated)
  })
})
