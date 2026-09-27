import type { Account } from '@/api/accounts'
import { accountType } from '@/components/finance/accountTypes'
import { fromCents, toCents } from '@/utils/money'

export interface CurrencyTotal {
  currency: string
  amount: string
}

/** What `accounts` add up to in each currency, the household's own currency first. */
export function totalsByCurrency(accounts: Account[], household: string): CurrencyTotal[] {
  const cents = new Map<string, number>()
  for (const account of accounts) {
    cents.set(account.currency, (cents.get(account.currency) ?? 0) + toCents(account.balance))
  }
  return [...cents]
    .sort(([a], [b]) => Number(b === household) - Number(a === household) || a.localeCompare(b))
    .map(([currency, total]) => ({ currency, amount: fromCents(total) }))
}

export interface NetWorth {
  currency: string
  assets: string
  /** What's owed, as a positive amount. */
  liabilities: string
  net: string
}

/**
 * Assets, money owed and what's left: `main` in the household's currency, even with no accounts
 * in it, and `others` for any other currencies, which aren't converted.
 */
export function netWorth(
  accounts: Account[],
  household: string,
): { main: NetWorth; others: NetWorth[] } {
  const byCurrency = new Map<string, { assets: number; owed: number }>([
    [household, { assets: 0, owed: 0 }],
  ])
  for (const account of accounts) {
    const totals = byCurrency.get(account.currency) ?? { assets: 0, owed: 0 }
    if (accountType(account.type).liability) totals.owed -= toCents(account.balance)
    else totals.assets += toCents(account.balance)
    byCurrency.set(account.currency, totals)
  }
  const [main, ...others] = [...byCurrency]
    .sort(([a], [b]) => Number(b === household) - Number(a === household) || a.localeCompare(b))
    .map(([currency, { assets, owed }]) => ({
      currency,
      assets: fromCents(assets),
      liabilities: fromCents(owed),
      net: fromCents(assets - owed),
    }))
  return { main: main as NetWorth, others }
}
