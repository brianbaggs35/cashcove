import * as bills from '@/api/bills'
import { recurringApi } from '@/api/recurring'
import * as subscriptions from '@/api/subscriptions'
import type { SubscriptionInput } from '@/api/subscriptions'
import { makeSubscription } from '@/test/subscriptions'

const input: SubscriptionInput = {
  name: 'Streamflix',
  payee: 'Streamflix',
  amount: '14.99',
  amount_varies: false,
  frequency: 'monthly',
  account_id: 'account-checking',
  next_due_date: '2026-10-15',
  category_id: null,
  notes: null,
  seed_transaction_id: null,
}

describe('recurringApi', () => {
  it('makes every call for a subscription to the subscriptions API', async () => {
    const item = makeSubscription()
    const calls = {
      fetch: vi.spyOn(subscriptions, 'fetchSubscriptions').mockResolvedValue([item]),
      create: vi.spyOn(subscriptions, 'createSubscription').mockResolvedValue(item),
      update: vi.spyOn(subscriptions, 'updateSubscription').mockResolvedValue(item),
      remove: vi.spyOn(subscriptions, 'deleteSubscription').mockResolvedValue(undefined),
      link: vi
        .spyOn(subscriptions, 'linkSubscriptionPayments')
        .mockResolvedValue({ count: 1, subscription: item }),
      unlink: vi.spyOn(subscriptions, 'unlinkSubscriptionPayment').mockResolvedValue(item),
    }
    const api = recurringApi('subscription')

    await api.fetch(true)
    await api.create(input)
    await api.update('s1', { active: false })
    await api.remove('s1')
    await api.link('s1', ['t1'])
    await api.unlink('s1', 't1')

    expect(calls.fetch).toHaveBeenCalledWith(true)
    expect(calls.create).toHaveBeenCalledWith(input)
    expect(calls.update).toHaveBeenCalledWith('s1', { active: false })
    expect(calls.remove).toHaveBeenCalledWith('s1')
    expect(calls.link).toHaveBeenCalledWith('s1', ['t1'])
    expect(calls.unlink).toHaveBeenCalledWith('s1', 't1')
  })

  it('makes every call for a bill to the bills API', async () => {
    const item = makeSubscription({ kind: 'bill' })
    const calls = {
      fetch: vi.spyOn(bills, 'fetchBills').mockResolvedValue([item]),
      create: vi.spyOn(bills, 'createBill').mockResolvedValue(item),
      update: vi.spyOn(bills, 'updateBill').mockResolvedValue(item),
      remove: vi.spyOn(bills, 'deleteBill').mockResolvedValue(undefined),
      link: vi.spyOn(bills, 'linkBillPayments').mockResolvedValue({ count: 1, subscription: item }),
      unlink: vi.spyOn(bills, 'unlinkBillPayment').mockResolvedValue(item),
    }
    const api = recurringApi('bill')

    await api.fetch(false)
    await api.create(input)
    await api.update('b1', { active: true })
    await api.remove('b1')
    await api.link('b1', ['t1', 't2'])
    await api.unlink('b1', 't2')

    expect(calls.fetch).toHaveBeenCalledWith(false)
    expect(calls.create).toHaveBeenCalledWith(input)
    expect(calls.update).toHaveBeenCalledWith('b1', { active: true })
    expect(calls.remove).toHaveBeenCalledWith('b1')
    expect(calls.link).toHaveBeenCalledWith('b1', ['t1', 't2'])
    expect(calls.unlink).toHaveBeenCalledWith('b1', 't2')
  })
})
