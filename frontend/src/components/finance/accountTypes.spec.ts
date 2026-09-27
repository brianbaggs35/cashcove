import type { AccountType } from '@/api/accounts'
import { accountGroup, accountType, accountTypes } from '@/components/finance/accountTypes'

describe('account types', () => {
  it('knows which types are money owed', () => {
    expect(accountTypes.filter((info) => info.liability).map((info) => info.value)).toEqual([
      'credit_card',
      'loan',
      'mortgage',
    ])
  })

  it('groups types the way the Accounts tab lists them', () => {
    expect(accountGroup('savings').title).toBe('Cash')
    expect(accountGroup('mortgage').title).toBe('Loans')
    expect(accountGroup('investment').color).toBe('success')
  })

  it('treats a type it does not know as other', () => {
    expect(accountType('piggy_bank' as AccountType).title).toBe('Other')
  })
})
