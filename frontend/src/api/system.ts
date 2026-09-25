import { apiGet } from '@/api/client'

export interface SystemInfo {
  version: string
  environment: string
  plaid: { configured: boolean; environment: 'sandbox' | 'production' }
}

export const fetchSystemInfo = () => apiGet<SystemInfo>('/system')
