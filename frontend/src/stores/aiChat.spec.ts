import { createPinia, setActivePinia } from 'pinia'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { MAX_LENGTH, MAX_TURNS, recentTurns, useAiChat, type ChatMessage } from '@/stores/aiChat'
import * as dates from '@/utils/dates'

function conversation(...roles: ('user' | 'assistant')[]): ChatMessage[] {
  return roles.map((role, index) => ({ id: index, role, content: `${role} ${index}` }))
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
    expect(chat.messages.map((message) => [message.role, message.content])).toEqual([
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
    let answer: (value: { reply: string }) => void = () => undefined
    const ask = vi.spyOn(api, 'askAi').mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const chat = useAiChat()

    const first = chat.send('One')
    expect(chat.busy).toBe(true)
    expect(await chat.send('Two')).toBe(false)
    expect(await chat.retry()).toBe(false)
    answer({ reply: 'Fine.' })
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
    expect(chat.messages.map((message) => message.role)).toEqual(['user'])
    expect(chat.busy).toBe(false)

    expect(await chat.retry()).toBe(true)

    expect(ask).toHaveBeenCalledTimes(2)
    expect(chat.error).toBeNull()
    expect(chat.code).toBeNull()
    expect(chat.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
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
