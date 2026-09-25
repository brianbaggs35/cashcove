import { ApiError, apiGet } from '@/api/client'

export interface Health {
  status: 'ok' | 'degraded'
  version: string
  database: 'ok' | 'unavailable'
}

export async function fetchHealth(): Promise<Health> {
  try {
    return await apiGet<Health>('/health')
  } catch (error) {
    // A 503 still means the API answered; it reports the database as unavailable.
    if (error instanceof ApiError && error.status === 503) {
      return { status: 'degraded', version: 'unknown', database: 'unavailable' }
    }
    throw error
  }
}
