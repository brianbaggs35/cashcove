import { checking, makeAccount, savings, visa } from '@/test/finance'
import { netWorth, totalsByCurrency } from '@/views/accounts/totals'

const euros = makeAccount({ id: 'euros', currency: 'EUR', balance: '100.10' })
const pounds = makeAccount({ id: 'pounds', currency: 'GBP', type: 'loan', balance: '-50.00' })

describe('account totals', () => {
  it('adds up balances per currency, the household currency first', () => {
    expect(totalsByCurrency([euros, checking, pounds, savings], 'USD')).toEqual([
      { currency: 'USD', amount: '14950.18' },
      { currency: 'EUR', amount: '100.10' },
      { currency: 'GBP', amount: '-50.00' },
    ])
    expect(totalsByCurrency([], 'USD')).toEqual([])
  })

  it('splits net worth into assets and what is owed', () => {
    const overdrawn = makeAccount({ id: 'overdrawn', balance: '-20.00' })
    const credit = makeAccount({ id: 'credit', type: 'credit_card', balance: '15.00' })
    const { main, others } = netWorth(
      [checking, savings, visa, overdrawn, credit, pounds, euros],
      'USD',
    )

    expect(main).toEqual({
      currency: 'USD',
      assets: '14930.18',
      liabilities: '597.40',
      net: '14332.78',
    })
    expect(others).toEqual([
      { currency: 'EUR', assets: '100.10', liabilities: '0.00', net: '100.10' },
      { currency: 'GBP', assets: '0.00', liabilities: '50.00', net: '-50.00' },
    ])
  })

  it('always has the household currency, even without accounts in it', () => {
    expect(netWorth([euros], 'USD').main).toEqual({
      currency: 'USD',
      assets: '0.00',
      liabilities: '0.00',
      net: '0.00',
    })
  })
})
