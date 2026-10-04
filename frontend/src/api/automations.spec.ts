import {
  createAutomation,
  deleteAutomation,
  fetchAutomations,
  previewAutomation,
  updateAutomation,
  type AutomationInput,
} from '@/api/automations'

function response(body?: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  }
}

describe('automation API', () => {
  it('lists, creates, changes and deletes automations', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(response([]))
      .mockResolvedValueOnce(response({ id: 'automation-1', applied: 4 }))
      .mockResolvedValueOnce(response({ id: 'automation-1', active: false, applied: 0 }))
      .mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetch)
    const input: AutomationInput = {
      name: 'Streaming',
      payees: ['Netflix', 'Hulu'],
      match: 'contains',
      account_id: null,
      min_amount: '2.99',
      max_amount: '10.99',
      category_id: 'category-subscriptions',
      subscription_id: 'subscription-netflix',
      counts: [{ budget_id: 'budget-1', kind: 'income' }],
      apply_to: 'all',
    }

    await expect(fetchAutomations()).resolves.toEqual([])
    await expect(createAutomation(input)).resolves.toEqual({ id: 'automation-1', applied: 4 })
    await expect(updateAutomation('automation-1', { active: false })).resolves.toMatchObject({
      active: false,
    })
    await expect(deleteAutomation('automation-1')).resolves.toBeUndefined()

    expect(fetch.mock.calls.map(([url, init]) => [url, init.method])).toEqual([
      ['/api/automations', 'GET'],
      ['/api/automations', 'POST'],
      ['/api/automations/automation-1', 'PATCH'],
      ['/api/automations/automation-1', 'DELETE'],
    ])
    expect(JSON.parse(fetch.mock.calls[1]![1].body as string)).toEqual(input)
    expect(JSON.parse(fetch.mock.calls[2]![1].body as string)).toEqual({ active: false })
  })

  it('previews what an automation like this would sort, and what overlaps it', async () => {
    const fetch = vi.fn().mockResolvedValue(response({ matching: 3, overlaps: [] }))
    vi.stubGlobal('fetch', fetch)

    await expect(
      previewAutomation({
        payees: ['Netflix'],
        match: 'starts_with',
        accountId: 'account-visa',
        minAmount: '2.99',
        maxAmount: null,
        automationId: 'automation-1',
        category: true,
        subscription: false,
      }),
    ).resolves.toEqual({ matching: 3, overlaps: [] })

    expect(fetch.mock.calls[0]![0]).toBe('/api/automations/preview')
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string)).toEqual({
      payees: ['Netflix'],
      match: 'starts_with',
      account_id: 'account-visa',
      min_amount: '2.99',
      max_amount: null,
      automation_id: 'automation-1',
      category: true,
      subscription: false,
    })
  })
})
