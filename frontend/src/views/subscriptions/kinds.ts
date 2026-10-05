import { ReceiptText, Repeat, type LucideIcon } from '@lucide/vue'

import type { AlertPreferences } from '@/api/preferences'
import type { RecurringKind } from '@/api/subscriptions'
import type { NavName } from '@/navigation'

/**
 * How a kind of recurring payment is named and shown. The Subscriptions and Bills tabs are the
 * same page, card and dialogs, since both are tracked, matched to transactions and sorted by
 * automations the same way, so they read what differs from here.
 */
export interface KindCopy {
  /** Its tab in the navigation. */
  tab: NavName
  /** What it's called in a sentence: "subscription". */
  noun: string
  /** What it's called to start one: "Subscription". */
  title: string
  /** What several are called: "subscriptions". */
  nouns: string
  icon: LucideIcon
  /** The empty page's invitation to add the first. */
  empty: { title: string; text: string }
  /** What the dialog says it does when adding or changing one. */
  dialogSubtitle: string
  /** What its name field is called. */
  nameLabel: string
  /** What the date of its next payment is called. */
  dueLabel: string
  /** How many days before it's due the reminder starts, until someone changes it in Settings. */
  defaultReminderDays: number
}

export const kinds: Record<RecurringKind, KindCopy> = {
  subscription: {
    tab: 'subscriptions',
    noun: 'subscription',
    title: 'Subscription',
    nouns: 'subscriptions',
    icon: Repeat,
    empty: {
      title: 'Know what’s coming up',
      text: 'Keep recurring bills and memberships in one place, with reminders before they renew.',
    },
    dialogSubtitle: 'Track renewals and automatically match payments from the same account.',
    nameLabel: 'Subscription name',
    dueLabel: 'Next payment date',
    defaultReminderDays: 3,
  },
  bill: {
    tab: 'bills',
    noun: 'bill',
    title: 'Bill',
    nouns: 'bills',
    icon: ReceiptText,
    empty: {
      title: 'Never miss a due date',
      text: 'Keep your electricity, phone and other bills in one place. Cashcove links the payments you make and reminds you before each one is due.',
    },
    dialogSubtitle:
      'Track due dates and automatically link the payments you make from the same account.',
    nameLabel: 'Bill name',
    dueLabel: 'Next due date',
    defaultReminderDays: 5,
  },
}

/** Whether to warn before payments of a kind are due, and how many days ahead, as Settings has it. */
export function dueReminder(
  alerts: AlertPreferences | undefined,
  kind: RecurringKind,
): { enabled: boolean; days: number } {
  const days = kinds[kind].defaultReminderDays
  if (!alerts) return { enabled: false, days }
  return kind === 'bill'
    ? { enabled: alerts.bill_due_enabled, days: alerts.bill_due_days_before }
    : { enabled: alerts.subscription_due_enabled, days: alerts.subscription_due_days_before }
}

/** The test ID of a part of a kind's page, e.g. `subscription-add` or `bill-add`. */
export const partOf = (kind: RecurringKind, part: string): string => `${kind}-${part}`

/** The test ID of a part of a kind's page that's about all of them, e.g. `bills-error`. */
export const partsOf = (kind: RecurringKind, part: string): string => `${kind}s-${part}`
