import {
  ApiError,
  CSRF_HEADER,
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  configureApi,
  errorMessage,
  isCancelled,
} from '@/api/client'

function respond(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body),
  }
}

function mockFetch(...responses: ReturnType<typeof respond>[]) {
  const fetchMock = vi.fn()
  for (const response of responses) fetchMock.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.lastCall as [string, RequestInit]
  return { url, init, headers: init.headers as Headers }
}

async function failure(request: Promise<unknown>): Promise<ApiError> {
  const error = await request.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(ApiError)
  return error as ApiError
}

describe('api client', () => {
  it('GETs JSON from the /api prefix', async () => {
    const fetchMock = mockFetch(respond(200, { hello: 'world' }))
    await expect(apiGet('/thing')).resolves.toEqual({ hello: 'world' })
    const { url, init, headers } = lastCall(fetchMock)
    expect(url).toBe('/api/thing')
    expect(init.method).toBe('GET')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBeUndefined()
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.has('Content-Type')).toBe(false)
  })

  it.each([
    ['POST', apiPost],
    ['PUT', apiPut],
    ['PATCH', apiPatch],
  ] as const)('%ss a JSON body', async (method, send) => {
    const fetchMock = mockFetch(respond(200, { saved: true }))
    await expect(send('/thing', { a: 1 })).resolves.toEqual({ saved: true })
    const { init, headers } = lastCall(fetchMock)
    expect(init.method).toBe(method)
    expect(init.body).toBe('{"a":1}')
    expect(headers.get('Content-Type')).toBe('application/json')
  })

  it('POSTs without a body and DELETEs, resolving to nothing for 204', async () => {
    const fetchMock = mockFetch(respond(204), respond(204))
    await expect(apiPost('/thing')).resolves.toBeUndefined()
    expect(lastCall(fetchMock).init.body).toBeUndefined()
    await expect(apiDelete('/thing/1')).resolves.toBeUndefined()
    expect(lastCall(fetchMock).init.method).toBe('DELETE')
  })

  it('sends the CSRF token with changes but not with reads', async () => {
    configureApi({ csrfToken: () => 'token-123' })
    const fetchMock = mockFetch(respond(200, {}), respond(200, {}))
    await apiGet('/thing')
    expect(lastCall(fetchMock).headers.has(CSRF_HEADER)).toBe(false)
    await apiPost('/thing', {})
    expect(lastCall(fetchMock).headers.get(CSRF_HEADER)).toBe('token-123')
  })

  it('reports each successful request as activity', async () => {
    const activity = vi.fn()
    configureApi({ activity })
    mockFetch(respond(200, {}), respond(401, { detail: { code: 'x', message: 'No.' } }))
    await apiGet('/thing')
    await apiGet('/thing').catch(() => undefined)
    expect(activity).toHaveBeenCalledOnce()
  })

  it('turns a network failure into an offline error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await failure(apiGet('/thing'))
    expect(error).toMatchObject({ status: 0, code: 'offline', name: 'ApiError' })
    expect(error.message).toContain("Can't reach Cashcove")
  })

  it('reads the code, message and extra fields of an API error', async () => {
    mockFetch(
      respond(429, {
        detail: { code: 'too_many_attempts', message: 'Too many attempts.', retry_after: 30 },
      }),
    )
    const error = await failure(apiPost('/auth/sign-in', {}))
    expect(error).toMatchObject({
      status: 429,
      code: 'too_many_attempts',
      message: 'Too many attempts.',
      data: { retry_after: 30 },
      fields: {},
    })
    expect(error.retryAfter).toBe(30)
  })

  it('has no retry delay unless the API gave one', () => {
    expect(new ApiError(400, 'Nope.').retryAfter).toBeNull()
    expect(new ApiError(400, 'Nope.', { data: { retry_after: 'soon' } }).retryAfter).toBeNull()
    expect(new ApiError(400, 'Nope.')).toMatchObject({ code: 'error', data: {}, fields: {} })
  })

  it('turns validation errors into readable messages for each field', async () => {
    mockFetch(
      respond(422, {
        detail: [
          { loc: ['body', 'email'], msg: 'value is not a valid email address' },
          { loc: ['body', 'email'], msg: 'a second problem with the same field' },
          { loc: ['body', 'name'], msg: 'String should have at most 80 characters' },
          { loc: ['body', 'note'], msg: 'String should have at least 1 character' },
          { loc: ['body', 'extra'], msg: 'Something else' },
          { loc: ['body', 'other'], msg: 'Already ends with a full stop.' },
          'not an issue',
        ],
      }),
    )
    const error = await failure(apiPost('/users/invitations', {}))
    expect(error.code).toBe('invalid')
    expect(error.message).toBe('Check the highlighted fields and try again.')
    expect(error.fields).toEqual({
      email: 'Enter a valid email address.',
      name: 'This is too long.',
      note: 'This is required.',
      extra: 'Something else.',
      other: 'Already ends with a full stop.',
    })
  })

  it('uses the message of a single invalid field as the error', async () => {
    mockFetch(respond(422, { detail: [{ loc: ['body', 'name'], msg: 'Field required' }] }))
    const error = await failure(apiPost('/thing', {}))
    expect(error.message).toBe('Field required.')
    expect(error.fields).toEqual({ name: 'Field required.' })
  })

  it('falls back to the generic message when no issue is readable', async () => {
    mockFetch(respond(422, { detail: [] }))
    const error = await failure(apiPost('/thing', {}))
    expect(error.message).toBe('Check the highlighted fields and try again.')
  })

  it.each([
    [429, undefined, 'rate_limited', 'Too many requests. Wait a minute and try again.'],
    [
      500,
      { detail: 'Internal' },
      'server_error',
      'Cashcove ran into a problem. Try again in a moment.',
    ],
    [502, undefined, 'server_error', 'Cashcove ran into a problem. Try again in a moment.'],
    [404, { detail: 'Not Found' }, 'error', 'Not Found.'],
    [400, { detail: 'Already punctuated.' }, 'error', 'Already punctuated.'],
    [403, ['unexpected'], 'error', 'The request failed (error 403).'],
    [409, undefined, 'error', 'The request failed (error 409).'],
  ])('describes a %i response', async (status, body, code, message) => {
    mockFetch(respond(status, body))
    const error = await failure(apiGet('/thing'))
    expect(error).toMatchObject({ status, code, message })
  })

  it('asks the person to confirm it is them, then retries once', async () => {
    const verify = vi.fn().mockResolvedValue(true)
    configureApi({ verify })
    const needsVerification = respond(403, {
      detail: { code: 'verification_required', message: 'Confirm it is you.' },
    })
    const fetchMock = mockFetch(needsVerification, respond(200, { ok: true }))
    await expect(apiPatch('/users/1', { role: 'admin' })).resolves.toEqual({ ok: true })
    expect(verify).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives up when the person does not confirm, or the retry needs it again', async () => {
    const verify = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true)
    configureApi({ verify })
    const needsVerification = () =>
      respond(403, { detail: { code: 'verification_required', message: 'Confirm it is you.' } })
    mockFetch(needsVerification(), needsVerification(), needsVerification())
    const declined = await failure(apiDelete('/account/totp'))
    expect(isCancelled(declined)).toBe(true)
    const again = await failure(apiDelete('/account/totp'))
    expect(again.code).toBe('verification_required')
    expect(verify).toHaveBeenCalledTimes(2)
  })

  it('tells the app when the API says nobody is signed in', async () => {
    const signedOut = vi.fn()
    configureApi({ signedOut })
    mockFetch(respond(401, { detail: { code: 'not_signed_in', message: 'Sign in again.' } }))
    await failure(apiGet('/account'))
    expect(signedOut).toHaveBeenCalledOnce()
  })

  it('works with the default hooks', async () => {
    mockFetch(
      respond(403, { detail: { code: 'verification_required', message: 'Confirm it is you.' } }),
      respond(401, { detail: { code: 'not_signed_in', message: 'Sign in again.' } }),
    )
    expect((await failure(apiPost('/thing'))).code).toBe('verification_required')
    expect((await failure(apiGet('/thing'))).code).toBe('not_signed_in')
  })
})

describe('errorMessage', () => {
  it('uses the message of an error, or the value itself', () => {
    expect(errorMessage(new Error('Boom.'))).toBe('Boom.')
    expect(errorMessage('plain')).toBe('plain')
  })
})

describe('isCancelled', () => {
  it('is true only for a verification the person declined', () => {
    expect(isCancelled(new ApiError(403, 'x', { code: 'verification_required' }))).toBe(true)
    expect(isCancelled(new ApiError(403, 'x', { code: 'forbidden' }))).toBe(false)
    expect(isCancelled(new Error('x'))).toBe(false)
  })
})
