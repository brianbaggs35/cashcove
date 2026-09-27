import { categoryKind, categoryKinds } from '@/components/finance/categoryKinds'

describe('category kinds', () => {
  it('offers spending first, then income and transfers', () => {
    expect(categoryKinds.map((kind) => [kind.value, kind.title, kind.color])).toEqual([
      ['expense', 'Spending', undefined],
      ['income', 'Income', 'success'],
      ['transfer', 'Transfers', 'info'],
    ])
  })

  it('finds a kind', () => {
    expect(categoryKind('transfer').text).toContain('between your own accounts')
  })
})
