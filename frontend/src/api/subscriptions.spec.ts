import {
  cancelSubscription,
  createSubscription,
  deleteSubscription,
  fetchSubscriptionOverview,
  fetchSubscriptions,
  linkSubscriptionPayments,
  reactivateSubscription,
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

  it('reads one subscription in full as of the day the person is in', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ summary: { total: '0.00' } }))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchSubscriptionOverview('sub-1', '2026-10-14')).resolves.toEqual({
      summary: { total: '0.00' },
    })

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/api/subscriptions/sub-1/overview?today=2026-10-14',
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
      ends_on: null,
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

  it('cancels one with the days it was cancelled and ends, and reactivates it with its next payment', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response({ id: 'sub-1', cancelled_on: '2026-10-19' }))
      .mockResolvedValueOnce(response({ id: 'sub-1', cancelled_on: null }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      cancelSubscription('sub-1', { cancelled_on: '2026-10-19', ends_on: '2026-11-05' }),
    ).resolves.toEqual({ id: 'sub-1', cancelled_on: '2026-10-19' })
    await expect(
      reactivateSubscription('sub-1', { next_due_date: '2027-01-05', today: '2026-12-20' }),
    ).resolves.toEqual({ id: 'sub-1', cancelled_on: null })

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/subscriptions/sub-1/cancellation', 'POST'],
      ['/api/subscriptions/sub-1/reactivation', 'POST'],
    ])
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({
      cancelled_on: '2026-10-19',
      ends_on: '2026-11-05',
    })
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual({
      next_due_date: '2027-01-05',
      today: '2026-12-20',
    })
  })
})
