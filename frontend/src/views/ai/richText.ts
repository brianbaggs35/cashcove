/** A run of text in a line: plain, or bold, or code. */
export interface Inline {
  text: string
  bold?: boolean
  code?: boolean
}

export type Block =
  { kind: 'paragraph'; parts: Inline[] } | { kind: 'list'; ordered: boolean; items: Inline[][] }

const BULLET = /^\s*[-*•]\s+(.*)$/
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/
const TABLE_ROW = /^\s*\|(.*)\|\s*$/
// The line of dashes under a table's heading.
const TABLE_RULE = /^[\s|:-]+$/
const SPANS = /\*\*(.+?)\*\*|`([^`]+)`/g

/** `**bold**` and `code` in a line. Anything else, stray asterisks included, is plain text. */
export function inline(text: string): Inline[] {
  const parts: Inline[] = []
  let last = 0
  for (const match of text.matchAll(SPANS)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    // One of the two groups always matched.
    parts.push(
      match[1] === undefined
        ? { text: match[2] as string, code: true }
        : { text: match[1], bold: true },
    )
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

/**
 * What an AI wrote, as paragraphs and lists, for showing as text. It never becomes HTML: the
 * parts of it are shown as text by Vue, so nothing in an answer, however it's written, can add
 * anything to the page. Headings are shown in bold, and a table as a line for each row, since
 * the AI is asked for neither and a phone has no room for a table.
 */
export function parseRichText(text: string): Block[] {
  const blocks: Block[] = []
  // What's being written: a paragraph's lines, or a list's items, never both.
  const open: { paragraph: string[]; list: { ordered: boolean; items: Inline[][] } | null } = {
    paragraph: [],
    list: null,
  }

  function flush() {
    if (open.paragraph.length) {
      blocks.push({ kind: 'paragraph', parts: inline(open.paragraph.join('\n')) })
    }
    if (open.list) blocks.push({ kind: 'list', ...open.list })
    open.paragraph = []
    open.list = null
  }

  function item(ordered: boolean, content: string) {
    if (open.list?.ordered !== ordered) {
      flush()
      open.list = { ordered, items: [] }
    }
    open.list.items.push(inline(content.trim()))
  }

  for (const line of text.split(/\r?\n/)) {
    const bullet = BULLET.exec(line)
    const numbered = NUMBERED.exec(line)
    const heading = HEADING.exec(line)
    const row = TABLE_ROW.exec(line)
    if (!line.trim()) flush()
    else if (bullet?.[1] !== undefined) item(false, bullet[1])
    else if (numbered?.[1] !== undefined) item(true, numbered[1])
    else if (heading?.[1] !== undefined) {
      flush()
      blocks.push({ kind: 'paragraph', parts: [{ text: heading[1].trim(), bold: true }] })
    } else if (row?.[1] !== undefined) {
      flush()
      if (!TABLE_RULE.test(row[1])) {
        const cells = row[1].split('|').map((cell) => cell.trim())
        blocks.push({ kind: 'paragraph', parts: inline(cells.filter(Boolean).join(' · ')) })
      }
    } else {
      if (open.list) flush()
      open.paragraph.push(line.trim())
    }
  }
  flush()
  return blocks
}
