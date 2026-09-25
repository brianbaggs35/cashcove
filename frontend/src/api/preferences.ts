import { apiGet, apiPut } from '@/api/client'

export const SYNC_INTERVALS = [1, 2, 4, 6, 12, 24] as const
export const HISTORY_DAYS = [30, 90, 180, 365, 730] as const

export interface GeneralPreferences {
  household_name: string
  currency: string
  locale: string
  week_starts_on: 'sunday' | 'monday'
  fiscal_year_start_month: number
}

export interface AlertPreferences {
  subscription_due_enabled: boolean
  subscription_due_days_before: number
  low_balance_enabled: boolean
  /** Decimal amounts travel as strings to avoid float rounding. */
  low_balance_threshold: string
  large_transaction_enabled: boolean
  large_transaction_threshold: string
  budget_threshold_enabled: boolean
  budget_threshold_percent: number
  sync_failure_enabled: boolean
}

export interface SyncPreferences {
  auto_sync: boolean
  interval_hours: (typeof SYNC_INTERVALS)[number]
  history_days: (typeof HISTORY_DAYS)[number]
}

export interface Preferences {
  general: GeneralPreferences
  alerts: AlertPreferences
  sync: SyncPreferences
}

export const fetchPreferences = () => apiGet<Preferences>('/settings')
export const savePreferences = (preferences: Preferences) =>
  apiPut<Preferences>('/settings', preferences)
