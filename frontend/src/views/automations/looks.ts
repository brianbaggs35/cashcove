import type { AutomationDirection, AutomationMatch } from '@/api/automations'
import { toCents } from '@/utils/money'

/** What an automation is for in how much a transaction was: any amount, one, or a range. */
export type AmountMode = 'any' | 'exactly' | 'between'

export const matchTitles: Record<AutomationMatch, string> = {
  exact: 'Exactly',
  starts_with: 'Starts with',
  contains: 'Contains',
}

/** What each way of matching means, since it compares the payee and what the bank called it. */
export const matchHints: Record<AutomationMatch, string> = {
  exact: 'The payee, or what the bank called it, is exactly this, ignoring letter case.',
  starts_with: 'The payee, or what the bank called it, starts with this.',
  contains: 'The payee, or what the bank called it, has this in it.',
}

export const matchItems = (Object.keys(matchTitles) as AutomationMatch[]).map((value) => ({
  value,
  title: matchTitles[value],
  props: { subtitle: matchHints[value] },
}))

/** A short way to say how a payee is compared, e.g. "Payee contains". */
export const matchPhrases: Record<AutomationMatch, string> = {
  exact: 'Payee is',
  starts_with: 'Payee starts with',
  contains: 'Payee contains',
}

export const directionTitles: Record<AutomationDirection, string> = {
  any: 'Either way',
  in: 'Money in',
  out: 'Money out',
}

/** What each choice of which way the money went is for, to say where to use it. */
export const directionHints: Record<AutomationDirection, string> = {
  any: 'Sorts the transaction whichever way the money went.',
  in: 'For money coming in, like a paycheck or a refund. A purchase from the same name is left alone.',
  out: 'For money going out, like a purchase or a bill.',
}

/** How the way the money went reads in a sentence about what an automation looks for. */
export const directionPhrases: Record<AutomationDirection, string | null> = {
  any: null,
  in: 'money in',
  out: 'money out',
}

/** Which way the money went in all of some transactions, or either way when it's mixed or there are none. */
export function directionOf(amounts: string[]): AutomationDirection {
  if (amounts.length && amounts.every((amount) => toCents(amount) > 0)) return 'in'
  if (amounts.length && amounts.every((amount) => toCents(amount) < 0)) return 'out'
  return 'any'
}

/** What payees are compared by, so "Netflix" and "NETFLIX  " are one. */
export function keyOf(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The amount limits a choice of mode and amounts stands for, as the API takes them. */
export function amountLimits(
  mode: AmountMode,
  exact: string | null,
  from: string | null,
  to: string | null,
): { min: string | null; max: string | null } {
  if (mode === 'exactly') return { min: exact, max: exact }
  if (mode === 'between') return { min: from, max: to }
  return { min: null, max: null }
}

/** The mode a pair of limits stands for, when changing an automation. */
export function amountMode(min: string | null, max: string | null): AmountMode {
  if (min === null && max === null) return 'any'
  return min === max ? 'exactly' : 'between'
}

/** What the amount fields of the form hold for a pair of limits, when changing an automation. */
export function amountFields(min: string | null, max: string | null) {
  const mode = amountMode(min, max)
  return {
    amountMode: mode,
    amountExact: mode === 'exactly' ? min : null,
    amountFrom: mode === 'between' ? min : null,
    amountTo: mode === 'between' ? max : null,
  }
}

/** Whether the amounts someone typed can be used: what's needed is there and in order. */
export function amountsValid(
  mode: AmountMode,
  exact: string | null,
  from: string | null,
  to: string | null,
): boolean {
  if (mode === 'any') return true
  if (mode === 'exactly') return exact !== null && toCents(exact) > 0
  if (from === null && to === null) return false
  return from === null || to === null || toCents(from) <= toCents(to)
}

/** The name an automation gets from what it looks for. */
export function nameFor(payees: string[]): string {
  const [first = ''] = payees
  return (payees.length > 1 ? `${first} and ${payees.length - 1} more` : first).slice(0, 120)
}

/** The smallest and largest amounts among some transactions, whichever way the money went. */
export function amountRange(amounts: string[]): { min: string; max: string } | null {
  if (!amounts.length) return null
  const cents = amounts.map((amount) => Math.abs(toCents(amount)))
  const format = (value: number) => (value / 100).toFixed(2)
  return { min: format(Math.min(...cents)), max: format(Math.max(...cents)) }
}

/** How much a transaction has to be for, in words, e.g. "exactly $2.99", or null for any amount. */
export function amountPhrase(
  { min, max }: { min: string | null; max: string | null },
  format: (amount: string) => string,
): string | null {
  if (min !== null && min === max) return `exactly ${format(min)}`
  if (min !== null && max !== null) return `${format(min)} to ${format(max)}`
  if (min !== null) return `at least ${format(min)}`
  if (max !== null) return `up to ${format(max)}`
  return null
}
