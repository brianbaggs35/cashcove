import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import {
  MAX_LENGTH,
  MAX_TURNS,
  recentTurns,
  useAiChat,
  type ChatMessage,
  type StatementMessage,
} from '@/stores/aiChat'
import { makeStatementReading } from '@/test/ai'
import { later, makeImport } from '@/test/imports'
import * as dates from '@/utils/dates'

function conversation(...roles: ('user' | 'assistant')[]): ChatMessage[] {
  return roles.map((role, index) => ({
    kind: 'text',
    id: index,
    role,
    content: `${role} ${index}`,
  }))
}

/** What was said in words, by who. */
function said(chat: ReturnType<typeof useAiChat>) {
  return chat.messages.flatMap((message) =>
    message.kind === 'text' ? [[message.role, message.content]] : [],
  )
}

describe('recentTurns', () => {
  it('sends a short conversation as it is', () => {
    expect(recentTurns(conversation('user', 'assistant', 'user'))).toEqual([
      { role: 'user', content: 'user 0' },
      { role: 'assistant', content: 'assistant 1' },
      { role: 'user', content: 'user 2' },
    ])
  })

  it('sends only the latest turns of a long one, starting with a question', () => {
    const roles = Array.from({ length: 30 }, (_, index) => (index % 2 ? 'assistant' : 'user')) as (
      'user' | 'assistant'
    )[]

    const turns = recentTurns(conversation(...roles))

    // The last 24 start with an answer (the 7th turn, 0-based 6, is a question: 6 is even).
    expect(turns.length).toBeLessThanOrEqual(MAX_TURNS)
    expect(turns[0]?.role).toBe('user')
    expect(turns.at(-1)).toEqual({ role: 'assistant', content: 'assistant 29' })
  })

  it('drops a leading answer', () => {
    const roles: ('user' | 'assistant')[] = [
      'assistant',
      ...Array.from({ length: 23 }, () => 'user' as const),
    ]

    const turns = recentTurns(conversation(...roles))

    expect(turns).toHaveLength(23)
    expect(turns[0]?.role).toBe('user')
  })

  it('has nothing to send when nothing in it is a question', () => {
    expect(recentTurns(conversation('assistant', 'assistant'))).toEqual([])
    expect(recentTurns([])).toEqual([])
  })

  it('leaves a statement out: what the AI read of it is sent apart, with names taken out', () => {
    const file: ChatMessage = { kind: 'file', id: 5, role: 'user', name: 'september.pdf', size: 12 }
    const read: StatementMessage = {
      kind: 'statement',
      id: 6,
      role: 'assistant',
      file: new File(['%PDF'], 'september.pdf'),
      status: 'done',
      reading: makeStatementReading(),
      error: null,
      imported: null,
    }

    expect(recentTurns([...conversation('user'), file, read])).toEqual([
      { role: 'user', content: 'user 0' },
    ])
  })
})

describe('ai chat store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
  })

  it('asks a question and keeps the answer', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'About 84.12.' })
    const chat = useAiChat()

    const sent = await chat.send('  How much on groceries?  ')

    expect(sent).toBe(true)
    expect(ask).toHaveBeenCalledWith(
      [{ role: 'user', content: 'How much on groceries?' }],
      '2026-09-20',
    )
    expect(said(chat)).toEqual([
      ['user', 'How much on groceries?'],
      ['assistant', 'About 84.12.'],
    ])
    expect(chat.busy).toBe(false)
    expect(chat.error).toBeNull()
  })

  it('sends the whole conversation each time', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'Ok.' })
    const chat = useAiChat()

    await chat.send('One')
    await chat.send('Two')

    expect(ask).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: 'One' },
        { role: 'assistant', content: 'Ok.' },
        { role: 'user', content: 'Two' },
      ],
      '2026-09-20',
    )
  })

  it('is busy while it waits, and won’t ask two things at once', async () => {
    const answer = later<{ reply: string }>()
    const ask = vi.spyOn(api, 'askAi').mockReturnValue(answer.promise)
    const chat = useAiChat()

    const first = chat.send('One')
    expect(chat.busy).toBe(true)
    // A question is answered with the dots; only a statement being read has its own say.
    expect(chat.reading).toBe(false)
    expect(await chat.send('Two')).toBe(false)
    expect(await chat.retry()).toBe(false)
    answer.resolve({ reply: 'Fine.' })
    await first

    expect(ask).toHaveBeenCalledTimes(1)
    expect(chat.messages).toHaveLength(2)
  })

  it.each(['', '   ', 'x'.repeat(MAX_LENGTH + 1)])('doesn’t ask %j', async (text) => {
    const ask = vi.spyOn(api, 'askAi')
    const chat = useAiChat()

    expect(await chat.send(text)).toBe(false)

    expect(ask).not.toHaveBeenCalled()
    expect(chat.messages).toEqual([])
  })

  it('keeps the question, says what went wrong and tries again when asked', async () => {
    const ask = vi
      .spyOn(api, 'askAi')
      .mockRejectedValueOnce(
        new ApiError(502, 'The AI didn’t answer in time.', { code: 'ai_unreachable' }),
      )
      .mockResolvedValueOnce({ reply: 'Here you go.' })
    const chat = useAiChat()

    expect(await chat.send('Hello?')).toBe(false)

    expect(chat.error).toBe('The AI didn’t answer in time.')
    expect(chat.code).toBe('ai_unreachable')
    expect(said(chat).map(([role]) => role)).toEqual(['user'])
    expect(chat.busy).toBe(false)

    expect(await chat.retry()).toBe(true)

    expect(ask).toHaveBeenCalledTimes(2)
    expect(chat.error).toBeNull()
    expect(chat.code).toBeNull()
    expect(said(chat).map(([role]) => role)).toEqual(['user', 'assistant'])
  })

  it('has no code for an error that didn’t come from the API', async () => {
    vi.spyOn(api, 'askAi').mockRejectedValue(new Error('Boom'))
    const chat = useAiChat()

    await chat.send('Hello?')

    expect(chat.error).toBe('Boom')
    expect(chat.code).toBeNull()
  })

  it('starts again when cleared', async () => {
    vi.spyOn(api, 'askAi').mockRejectedValue(new ApiError(422, 'Blocked.', { code: 'ai_blocked' }))
    const chat = useAiChat()
    await chat.send('Hello?')

    chat.clear()

    expect(chat.messages).toEqual([])
    expect(chat.error).toBeNull()
    expect(chat.code).toBeNull()
  })
})

describe('ai chat store, with a statement', () => {
  const pdf = () => new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' })

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('adds the file to the conversation, and has the AI read it', async () => {
    const reading = vi.spyOn(api, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    const chat = useAiChat()

    const message = await chat.attach(pdf())

    expect(reading).toHaveBeenCalledWith({ file_name: 'september.pdf', content: btoa('%PDF-1.7') })
    expect(chat.messages.map((item) => item.kind)).toEqual(['file', 'statement'])
    expect(chat.messages[0]).toMatchObject({ role: 'user', name: 'september.pdf', size: 8 })
    expect(message).toBe(chat.messages[1])
    expect(message).toMatchObject({ status: 'done', reading: makeStatementReading(), error: null })
    expect(chat.busy).toBe(false)
  })

  it('is busy while the AI reads, and is asked nothing else', async () => {
    const slow = new Promise<api.StatementReading>(() => undefined)
    vi.spyOn(api, 'readStatementWithAi').mockReturnValue(slow)
    const ask = vi.spyOn(api, 'askAi')
    const chat = useAiChat()

    void chat.attach(pdf())

    await vi.waitFor(() => {
      expect(chat.busy).toBe(true)
    })
    expect(chat.messages[1]).toMatchObject({ status: 'reading' })
    expect(chat.reading).toBe(true)
    expect(await chat.attach(pdf())).toBeNull()
    expect(await chat.send('Hello?')).toBe(false)
    expect(chat.messages).toHaveLength(2)
    expect(ask).not.toHaveBeenCalled()
  })

  it('says why a statement couldn’t be read, and reads it again when asked', async () => {
    const reading = vi.spyOn(api, 'readStatementWithAi')
    reading
      .mockRejectedValueOnce(
        new ApiError(422, 'There’s no text in this PDF.', { code: 'unreadable_statement' }),
      )
      .mockResolvedValueOnce(makeStatementReading())
    const chat = useAiChat()

    expect(await chat.attach(pdf())).toBeNull()

    const message = chat.messages[1] as StatementMessage
    expect(message).toMatchObject({ status: 'failed', error: 'There’s no text in this PDF.' })
    expect(chat.busy).toBe(false)

    expect(await chat.reread(message)).toBe(message)

    expect(message).toMatchObject({ status: 'done', error: null })
    expect(reading).toHaveBeenCalledTimes(2)
  })

  it('says why a PDF that can’t be sent can’t be read', async () => {
    const reading = vi.spyOn(api, 'readStatementWithAi')
    const chat = useAiChat()

    await chat.attach(new File([], 'empty.pdf'))

    expect(reading).not.toHaveBeenCalled()
    expect(chat.messages[1]).toMatchObject({
      status: 'failed',
      error: 'empty.pdf is empty. Download it from your bank again.',
    })
  })

  it('can be told to stop waiting, and then ignores the answer that comes', async () => {
    const answer = later<api.StatementReading>()
    vi.spyOn(api, 'readStatementWithAi').mockReturnValue(answer.promise)
    vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'Fine.' })
    const chat = useAiChat()
    const reading = chat.attach(pdf())
    await vi.waitFor(() => {
      expect(chat.busy).toBe(true)
    })

    chat.cancel()

    expect(chat.messages[1]).toMatchObject({ status: 'cancelled' })
    expect(chat.busy).toBe(false)
    expect(chat.reading).toBe(false)
    // It's free for a question, which a late answer doesn't interrupt.
    const asking = chat.send('Another?')
    answer.resolve(makeStatementReading())
    expect(await reading).toBeNull()
    await asking
    expect(chat.messages[1]).toMatchObject({ status: 'cancelled', reading: null })
    expect(chat.busy).toBe(false)
  })

  it('ignores a failure that comes after it was stopped', async () => {
    const failure = later<api.StatementReading>()
    const read = vi.spyOn(api, 'readStatementWithAi').mockReturnValue(failure.promise)
    const chat = useAiChat()
    const reading = chat.attach(pdf())
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(1)
    })

    chat.cancel()
    failure.reject(new Error('Offline'))

    expect(await reading).toBeNull()
    expect(chat.messages[1]).toMatchObject({ status: 'cancelled', error: null })
  })

  it('has nothing to stop when nothing is being read', () => {
    const chat = useAiChat()

    chat.cancel()

    expect(chat.busy).toBe(false)
  })

  it('won’t read a statement again while something else is going on', async () => {
    vi.spyOn(api, 'readStatementWithAi').mockRejectedValue(new Error('Offline'))
    const answer = later<{ reply: string }>()
    const chat = useAiChat()
    await chat.attach(pdf())
    vi.spyOn(api, 'askAi').mockReturnValue(answer.promise)
    void chat.send('Hello?')

    expect(await chat.reread(chat.messages[1] as StatementMessage)).toBeNull()

    answer.resolve({ reply: 'Hi.' })
  })

  it('remembers what importing a statement’s transactions added', async () => {
    vi.spyOn(api, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    const chat = useAiChat()
    await chat.attach(pdf())
    const record = makeImport({ format: 'pdf', file_name: 'september.pdf' })

    chat.imported(chat.messages[0]?.id as number, record)
    expect(chat.messages[1]).toMatchObject({ imported: null })
    chat.imported(chat.messages[1]?.id as number, record)
    chat.imported(9999, record)

    expect(chat.messages[1]).toMatchObject({ imported: record })
  })

  it('starts again when cleared, statements and all', async () => {
    vi.spyOn(api, 'readStatementWithAi').mockResolvedValue(makeStatementReading())
    const chat = useAiChat()
    await chat.attach(pdf())

    chat.clear()

    expect(chat.messages).toEqual([])
  })
})
