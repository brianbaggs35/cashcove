import type { Account } from '@/api/accounts'
import type { Category, CategoryGroup } from '@/api/categories'
import type { Transaction, TransactionPage } from '@/api/transactions'
import { useAccountsStore } from '@/stores/accounts'
import { useCategoriesStore } from '@/stores/categories'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences } from '@/test/fixtures'

export function makeAccount(changes: Partial<Account> = {}): Account {
  return {
    id: 'account-checking',
    name: 'Everyday checking',
    type: 'checking',
    institution: 'Harbor Credit Union',
    mask: '4410',
    currency: 'USD',
    balance: '2450.18',
    available_balance: null,
    credit_limit: null,
    balance_updated_at: '2026-09-20T12:00:00Z',
    notes: null,
    source: 'manual',
    connection_id: null,
    official_name: null,
    subtype: null,
    closed_at: null,
    created_at: '2026-01-15T12:00:00Z',
    transaction_count: 12,
    ...changes,
  }
}

export const checking = makeAccount()
export const savings = makeAccount({
  id: 'account-savings',
  name: 'Rainy day fund',
  type: 'savings',
  mask: null,
  balance: '12500.00',
  transaction_count: 2,
})
export const visa = makeAccount({
  id: 'account-visa',
  name: 'Rewards Visa',
  type: 'credit_card',
  institution: 'Tartan Bank',
  mask: '3333',
  balance: '-612.40',
  available_balance: '4387.60',
  credit_limit: '5000.00',
  source: 'plaid',
  connection_id: 'connection-tartan',
  official_name: 'Tartan Rewards Visa Signature',
  subtype: 'credit card',
  transaction_count: 30,
})

export function makeCategory(changes: Partial<Category> = {}): Category {
  return {
    id: 'category-groceries',
    group_id: 'group-food',
    name: 'Groceries',
    emoji: '🛒',
    transaction_count: 4,
    ...changes,
  }
}

export const groceries = makeCategory()
export const coffee = makeCategory({
  id: 'category-coffee',
  name: 'Coffee',
  emoji: '☕',
  transaction_count: 1,
})
export const paycheck = makeCategory({
  id: 'category-paycheck',
  group_id: 'group-income',
  name: 'Paycheck',
  emoji: '💼',
  transaction_count: 2,
})
export const transfers = makeCategory({
  id: 'category-transfers',
  group_id: 'group-transfers',
  name: 'Transfers',
  emoji: '🔁',
  transaction_count: 0,
})

export function makeGroups(): CategoryGroup[] {
  return [
    { id: 'group-income', name: 'Income', kind: 'income', categories: [paycheck] },
    { id: 'group-food', name: 'Food & drink', kind: 'expense', categories: [coffee, groceries] },
    { id: 'group-empty', name: 'Hobbies', kind: 'expense', categories: [] },
    { id: 'group-transfers', name: 'Transfers', kind: 'transfer', categories: [transfers] },
  ]
}

export function makeTransaction(changes: Partial<Transaction> = {}): Transaction {
  return {
    id: 'transaction-groceries',
    account_id: checking.id,
    date: '2026-09-18',
    amount: '-84.12',
    payee: 'Whole Foods',
    original_description: null,
    category_id: groceries.id,
    subscription_id: null,
    notes: null,
    pending: false,
    source: 'manual',
    import_id: null,
    created_at: '2026-09-18T15:00:00Z',
    updated_at: '2026-09-18T15:00:00Z',
    ...changes,
  }
}

export const wholeFoods = makeTransaction()
export const salary = makeTransaction({
  id: 'transaction-salary',
  date: '2026-09-15',
  amount: '2400.00',
  payee: 'Acme Corp',
  category_id: paycheck.id,
})
export const latte = makeTransaction({
  id: 'transaction-latte',
  account_id: visa.id,
  date: '2026-09-19',
  amount: '-4.50',
  payee: 'Blue Bottle',
  original_description: 'BLUE BOTTLE COFFEE #12',
  category_id: coffee.id,
  pending: true,
  source: 'plaid',
})

export function makePage(
  items: Transaction[] = [latte, wholeFoods, salary],
  changes: Partial<TransactionPage> = {},
): TransactionPage {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 50,
    totals: [{ currency: 'USD', count: items.length, money_in: '2400.00', money_out: '-88.62' }],
    ...changes,
  }
}

/** Puts the household's preferences, accounts and categories in their stores, as if loaded. */
export function seedFinance({
  accounts = [checking, savings, visa],
  groups = makeGroups(),
}: { accounts?: Account[]; groups?: CategoryGroup[] } = {}) {
  const preferences = usePreferencesStore()
  preferences.saved = makePreferences()
  preferences.draft = makePreferences()
  const accountsStore = useAccountsStore()
  accountsStore.accounts = accounts
  accountsStore.loaded = true
  const categories = useCategoriesStore()
  categories.groups = groups
  categories.loaded = true
  return { preferences, accounts: accountsStore, categories }
}
