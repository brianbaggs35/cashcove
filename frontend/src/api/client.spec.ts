import { ApiError, apiGet } from '@/api/client'

function mockFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('apiGet', () => {
  it('requests JSON from the /api prefix and returns the body', async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ hello: 'world' }) })
    await expect(apiGet('/thing', { headers: { 'X-Test': '1' } })).resolves.toEqual({
      hello: 'world',
    })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/thing')
    expect(init.credentials).toBe('same-origin')
    const headers = init.headers as Headers
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('X-Test')).toBe('1')
  })

  it('works without extra init options', async () => {
    mockFetch({ ok: true, json: () => Promise.resolve([]) })
    await expect(apiGet('/list')).resolves.toEqual([])
  })

  it('throws an ApiError carrying the status on failure', async () => {
    mockFetch({ ok: false, status: 500 })
    const error = await apiGet('/broken').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 500,
      name: 'ApiError',
      message: 'GET /broken failed with 500',
    })
  })
})
