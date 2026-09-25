import { ApiError, apiGet, apiPut, apiRequest } from '@/api/client'

function mockFetch(response: Partial<Response>) {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.lastCall as [string, RequestInit]
  return { url, init, headers: init.headers as Headers }
}

describe('api client', () => {
  it('GETs JSON from the /api prefix', async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ hello: 'world' }) })
    await expect(apiGet('/thing')).resolves.toEqual({ hello: 'world' })
    const { url, init, headers } = lastCall(fetchMock)
    expect(url).toBe('/api/thing')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBeUndefined()
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('PUTs a JSON body', async () => {
    const fetchMock = mockFetch({ ok: true, json: () => Promise.resolve({ saved: true }) })
    await expect(apiPut('/thing', { a: 1 })).resolves.toEqual({ saved: true })
    const { init, headers } = lastCall(fetchMock)
    expect(init.method).toBe('PUT')
    expect(init.body).toBe('{"a":1}')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('throws an ApiError with the status and error body', async () => {
    mockFetch({ ok: false, status: 422, json: () => Promise.resolve({ detail: 'bad' }) })
    const error = await apiRequest('POST', '/broken', {}).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 422,
      name: 'ApiError',
      message: 'POST /broken failed with 422',
      detail: { detail: 'bad' },
    })
  })

  it('tolerates an error response without a JSON body', async () => {
    mockFetch({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('html')) })
    const error = await apiGet('/down').catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 502, detail: undefined })
  })
})
