import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptionPayments,
  fetchSubscriptions,
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

  it('requests a subscription’s most recent tracked payments', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ items: [] }))
    vi.stubGlobal('fetch', fetch)

    await expect(fetchSubscriptionPayments('sub / 1')).resolves.toEqual({ items: [] })
    expect(fetch.mock.calls[0]![0]).toBe(
      '/api/transactions?subscription_id=sub+%2F+1&page_size=5&sort=-date',
    )
  })
})
