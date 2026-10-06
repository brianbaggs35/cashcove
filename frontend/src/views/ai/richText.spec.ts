import { inline, parseRichText } from '@/views/ai/richText'

describe('inline', () => {
  it('finds bold and code, and leaves the rest as plain text', () => {
    expect(inline('You spent **$84.12** on `Groceries` today')).toEqual([
      { text: 'You spent ' },
      { text: '$84.12', bold: true },
      { text: ' on ' },
      { text: 'Groceries', code: true },
      { text: ' today' },
    ])
  })

  it('starts with a span, and has spans one after the other', () => {
    expect(inline('**$420.00**`Groceries`')).toEqual([
      { text: '$420.00', bold: true },
      { text: 'Groceries', code: true },
    ])
  })

  it('shows stray asterisks and backticks as they are', () => {
    expect(inline('a * b ** c ` d')).toEqual([{ text: 'a * b ** c ` d' }])
    expect(inline('')).toEqual([])
  })
})

describe('parseRichText', () => {
  it('splits paragraphs at blank lines and keeps the lines of one together', () => {
    expect(parseRichText('First line\nsecond line\n\nNext paragraph')).toEqual([
      { kind: 'paragraph', parts: [{ text: 'First line\nsecond line' }] },
      { kind: 'paragraph', parts: [{ text: 'Next paragraph' }] },
    ])
  })

  it('reads bulleted and numbered lists', () => {
    expect(
      parseRichText('Top:\n- Groceries 420.00\n* Coffee 105.50\n• Rent\n\n1. First\n2) Second'),
    ).toEqual([
      { kind: 'paragraph', parts: [{ text: 'Top:' }] },
      {
        kind: 'list',
        ordered: false,
        items: [[{ text: 'Groceries 420.00' }], [{ text: 'Coffee 105.50' }], [{ text: 'Rent' }]],
      },
      { kind: 'list', ordered: true, items: [[{ text: 'First' }], [{ text: 'Second' }]] },
    ])
  })

  it('starts a new list when the kind changes, and ends one when a paragraph follows', () => {
    expect(parseRichText('- one\n1. two\nthen words')).toEqual([
      { kind: 'list', ordered: false, items: [[{ text: 'one' }]] },
      { kind: 'list', ordered: true, items: [[{ text: 'two' }]] },
      { kind: 'paragraph', parts: [{ text: 'then words' }] },
    ])
  })

  it('shows headings in bold', () => {
    expect(parseRichText('## Spending\nBy category:')).toEqual([
      { kind: 'paragraph', parts: [{ text: 'Spending', bold: true }] },
      { kind: 'paragraph', parts: [{ text: 'By category:' }] },
    ])
  })

  it('shows a table as a line for each row, without its rule', () => {
    expect(
      parseRichText('| Category | Amount |\n| --- | ---: |\n| Groceries | 420.00 |\nDone'),
    ).toEqual([
      { kind: 'paragraph', parts: [{ text: 'Category · Amount' }] },
      { kind: 'paragraph', parts: [{ text: 'Groceries · 420.00' }] },
      { kind: 'paragraph', parts: [{ text: 'Done' }] },
    ])
  })

  it('has nothing for no text, and reads Windows line endings', () => {
    expect(parseRichText('')).toEqual([])
    expect(parseRichText('a\r\n\r\nb')).toEqual([
      { kind: 'paragraph', parts: [{ text: 'a' }] },
      { kind: 'paragraph', parts: [{ text: 'b' }] },
    ])
  })

  it('never makes HTML of anything: it is all text for Vue to show', () => {
    const [block] = parseRichText('<img src=x onerror=alert(1)> and <b>bold</b>')

    expect(block).toEqual({
      kind: 'paragraph',
      parts: [{ text: '<img src=x onerror=alert(1)> and <b>bold</b>' }],
    })
  })
})
