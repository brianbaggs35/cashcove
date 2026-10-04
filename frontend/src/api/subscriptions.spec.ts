import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
  linkSubscriptionPayments,
  unlinkSubscriptionPayment,
  updateSubscription,
  type SubscriptionInput,
} from '@/api/subscriptions'

function response(body?: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }
}

describe('subscription API', () => {
  it('lists all, active and paused subscriptions with explicit filters', async () => {
    const fetch = vi.fn().mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetch)

    await fetchSubscriptions()
    await fetchSubscriptions(true)
    await fetchSubscriptions(false)

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/subscriptions',
      '/api/subscriptions?active=true',
      '/api/subscriptions?active=false',
    ])
  })

  it('creates, updates and deletes a subscription', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'sub-1' }))
      .mockResolvedValueOnce(response({ id: 'sub-1', active: false }))
      .mockResolvedValueOnce(response(undefined))
    vi.stubGlobal('fetch', fetch)
    const input: SubscriptionInput = {
      name: 'Streamflix',
      payee: 'Streamflix',
      amount: '14.99',
      amount_varies: true,
      frequency: 'monthly',
      account_id: 'account-checking',
      next_due_date: '2026-10-15',
      category_id: null,
      notes: null,
      seed_transaction_id: 'transaction-1',
    }

    await expect(createSubscription(input)).resolves.toEqual({ id: 'sub-1' })
    await expect(updateSubscription('sub-1', { active: false })).resolves.toEqual({
      id: 'sub-1',
      active: false,
    })
    await expect(deleteSubscription('sub-1')).resolves.toBeUndefined()

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/subscriptions',
      '/api/subscriptions/sub-1',
      '/api/subscriptions/sub-1',
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual(input)
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({ active: false })
    expect(fetch.mock.calls[2]![1].method).toBe('DELETE')
  })

  it('links payments to a subscription and takes one off again', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ count: 2, subscription: { id: 'sub-1' } }))
      .mockResolvedValueOnce(response({ id: 'sub-1', payment_count: 1 }))
    vi.stubGlobal('fetch', fetch)

    await expect(linkSubscriptionPayments('sub-1', ['t1', 't2'])).resolves.toEqual({
      count: 2,
      subscription: { id: 'sub-1' },
    })
    await expect(unlinkSubscriptionPayment('sub-1', 't1')).resolves.toEqual({
      id: 'sub-1',
      payment_count: 1,
    })

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/subscriptions/sub-1/payments', 'POST'],
      ['/api/subscriptions/sub-1/payments/t1', 'DELETE'],
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({ ids: ['t1', 't2'] })
  })
})
