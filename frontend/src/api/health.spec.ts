import * as client from '@/api/client'
import { fetchHealth } from '@/api/health'

describe('fetchHealth', () => {
  it('returns the API health report', async () => {
    const report = { status: 'ok', database: 'ok' }
    vi.spyOn(client, 'apiGet').mockResolvedValue(report)
    await expect(fetchHealth()).resolves.toEqual(report)
    expect(client.apiGet).toHaveBeenCalledWith('/health')
  })

  it('treats a 503 as a degraded report', async () => {
    vi.spyOn(client, 'apiGet').mockRejectedValue(new client.ApiError(503, 'down'))
    await expect(fetchHealth()).resolves.toEqual({ status: 'degraded', database: 'unavailable' })
  })

  it('rethrows other API errors', async () => {
    vi.spyOn(client, 'apiGet').mockRejectedValue(new client.ApiError(502, 'bad gateway'))
    await expect(fetchHealth()).rejects.toThrow('bad gateway')
  })

  it('rethrows network errors', async () => {
    vi.spyOn(client, 'apiGet').mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchHealth()).rejects.toThrow('Failed to fetch')
  })
})
