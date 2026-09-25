import type { Health } from '@/api/health'
import type { Preferences } from '@/api/preferences'
import type { SystemInfo } from '@/api/system'

export function makePreferences(): Preferences {
  return {
    general: {
      household_name: 'My household',
      currency: 'USD',
      locale: 'en-US',
      week_starts_on: 'sunday',
      fiscal_year_start_month: 1,
    },
    alerts: {
      subscription_due_enabled: true,
      subscription_due_days_before: 3,
      low_balance_enabled: true,
      low_balance_threshold: '100.00',
      large_transaction_enabled: true,
      large_transaction_threshold: '500.00',
      budget_threshold_enabled: true,
      budget_threshold_percent: 90,
      sync_failure_enabled: true,
    },
    sync: { auto_sync: true, interval_hours: 6, history_days: 730 },
  }
}

export const healthyReport: Health = { status: 'ok', version: '0.1.0', database: 'ok' }
export const degradedReport: Health = {
  status: 'degraded',
  version: 'unknown',
  database: 'unavailable',
}

export function makeSystemInfo(plaid: Partial<SystemInfo['plaid']> = {}): SystemInfo {
  return {
    version: '0.1.0',
    environment: 'production',
    plaid: { configured: false, environment: 'sandbox', ...plaid },
  }
}
