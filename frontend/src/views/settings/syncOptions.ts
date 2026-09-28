import { HISTORY_DAYS, SYNC_INTERVALS } from '@/api/preferences'

/** How often automatic sync runs, e.g. "Every 6 hours". */
export function intervalLabel(hours: number): string {
  if (hours === 24) return 'Daily'
  return hours === 1 ? 'Every hour' : `Every ${hours} hours`
}

export const intervalOptions = SYNC_INTERVALS.map((hours) => ({
  value: hours,
  title: intervalLabel(hours),
}))

const historyLabels: Record<(typeof HISTORY_DAYS)[number], string> = {
  30: 'Last 30 days',
  90: 'Last 90 days',
  180: 'Last 6 months',
  365: 'Last year',
  730: 'Last 2 years (the most Plaid allows)',
}

/** How far back a new connection's transactions go. */
export const historyOptions = HISTORY_DAYS.map((days) => ({
  value: days,
  title: historyLabels[days],
}))
