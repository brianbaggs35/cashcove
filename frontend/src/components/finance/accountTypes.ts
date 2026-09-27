import {
  CircleDollarSign,
  CreditCard,
  HandCoins,
  House,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from '@lucide/vue'

import type { AccountType } from '@/api/accounts'

/** How the Accounts tab groups accounts. */
export type AccountGroupKey = 'cash' | 'credit' | 'investments' | 'loans' | 'other'

export interface AccountTypeInfo {
  value: AccountType
  title: string
  icon: LucideIcon
  group: AccountGroupKey
  /** Money owed, like a card or loan, whose balance counts against net worth. */
  liability: boolean
}

export interface AccountGroupInfo {
  key: AccountGroupKey
  title: string
  color: string
}

export const accountGroups: AccountGroupInfo[] = [
  { key: 'cash', title: 'Cash', color: 'primary' },
  { key: 'credit', title: 'Credit cards', color: 'secondary' },
  { key: 'investments', title: 'Investments', color: 'success' },
  { key: 'loans', title: 'Loans', color: 'warning' },
  { key: 'other', title: 'Other', color: 'info' },
]

export const accountTypes: AccountTypeInfo[] = [
  { value: 'checking', title: 'Checking', icon: Landmark, group: 'cash', liability: false },
  { value: 'savings', title: 'Savings', icon: PiggyBank, group: 'cash', liability: false },
  { value: 'cash', title: 'Cash', icon: Wallet, group: 'cash', liability: false },
  {
    value: 'credit_card',
    title: 'Credit card',
    icon: CreditCard,
    group: 'credit',
    liability: true,
  },
  {
    value: 'investment',
    title: 'Investment',
    icon: TrendingUp,
    group: 'investments',
    liability: false,
  },
  { value: 'loan', title: 'Loan', icon: HandCoins, group: 'loans', liability: true },
  { value: 'mortgage', title: 'Mortgage', icon: House, group: 'loans', liability: true },
  { value: 'other', title: 'Other', icon: CircleDollarSign, group: 'other', liability: false },
]

const types = new Map(accountTypes.map((info) => [info.value, info]))
const groups = new Map(accountGroups.map((info) => [info.key, info]))

export function accountType(type: AccountType): AccountTypeInfo {
  return types.get(type) ?? (types.get('other') as AccountTypeInfo)
}

export function accountGroup(type: AccountType): AccountGroupInfo {
  return groups.get(accountType(type).group) as AccountGroupInfo
}
