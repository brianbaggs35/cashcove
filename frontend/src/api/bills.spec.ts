import {
  createBill,
  deleteBill,
  fetchBills,
  linkBillPayments,
  unlinkBillPayment,
  updateBill,
} from '@/api/bills'
import type { SubscriptionInput } from '@/api/subscriptions'

function response(body?: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }
}

describe('bill API', () => {
  it('lists all, active and paused bills with explicit filters', async () => {
    const fetch = vi.fn().mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetch)

    await fetchBills()
    await fetchBills(true)
    await fetchBills(false)

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/bills',
      '/api/bills?active=true',
      '/api/bills?active=false',
    ])
  })

  it('creates, updates and deletes a bill', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'bill-1' }))
      .mockResolvedValueOnce(response({ id: 'bill-1', active: false }))
      .mockResolvedValueOnce(response(undefined))
    vi.stubGlobal('fetch', fetch)
    const input: SubscriptionInput = {
      name: 'City Power',
      payee: 'City Power & Light',
      amount: '96.40',
      amount_varies: true,
      frequency: 'monthly',
      account_id: 'account-checking',
      next_due_date: '2026-10-15',
      category_id: 'category-utilities',
      notes: null,
      seed_transaction_id: 'transaction-1',
    }

    await expect(createBill(input)).resolves.toEqual({ id: 'bill-1' })
    await expect(updateBill('bill-1', { active: false })).resolves.toEqual({
      id: 'bill-1',
      active: false,
    })
    await expect(deleteBill('bill-1')).resolves.toBeUndefined()

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/bills', 'POST'],
      ['/api/bills/bill-1', 'PATCH'],
      ['/api/bills/bill-1', 'DELETE'],
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual(input)
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ active: false })
  })

  it('links payments to a bill and takes one off again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ count: 2, subscription: { id: 'bill-1' } }))
      .mockResolvedValueOnce(response({ id: 'bill-1', payment_count: 1 }))
    vi.stubGlobal('fetch', fetch)

    await expect(linkBillPayments('bill-1', ['t1', 't2'])).resolves.toEqual({
      count: 2,
      subscription: { id: 'bill-1' },
    })
    await expect(unlinkBillPayment('bill-1', 't1')).resolves.toEqual({
      id: 'bill-1',
      payment_count: 1,
    })

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/bills/bill-1/payments', 'POST'],
      ['/api/bills/bill-1/payments/t1', 'DELETE'],
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ ids: ['t1', 't2'] })
  })
})
