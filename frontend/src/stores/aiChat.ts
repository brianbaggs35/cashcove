import { defineStore } from 'pinia'
import { ref } from 'vue'

import { askAi, type ChatTurn } from '@/api/ai'
import { ApiError, errorMessage } from '@/api/client'
import { todayIso } from '@/utils/dates'

export interface ChatMessage extends ChatTurn {
  id: number
}

/** The most turns the API takes at once; the oldest are left out of a longer conversation. */
export const MAX_TURNS = 24
/** The longest message the API takes. */
export const MAX_LENGTH = 4000

/**
 * The turns to send: the latest ones, starting with a question, since a conversation that starts
 * with an answer makes no sense to some providers.
 */
export function recentTurns(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns = messages.slice(-MAX_TURNS).map(({ role, content }) => ({ role, content }))
  const first = turns.findIndex((turn) => turn.role === 'user')
  return first < 0 ? [] : turns.slice(first)
}

/**
 * The conversation with the AI. It's kept for as long as the page is open, so moving between the
 * AI tab's pages doesn't lose it, and never stored anywhere.
 */
export const useAiChat = defineStore('ai-chat', () => {
  const messages = ref<ChatMessage[]>([])
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** The API's code for what went wrong, e.g. `ai_blocked` when nothing was sent. */
  const code = ref<string | null>(null)
  let counter = 0

  async function reply(): Promise<boolean> {
    busy.value = true
    error.value = null
    code.value = null
    try {
      const answer = await askAi(recentTurns(messages.value), todayIso())
      messages.value.push({ id: ++counter, role: 'assistant', content: answer.reply })
      return true
    } catch (askError) {
      error.value = errorMessage(askError)
      code.value = askError instanceof ApiError ? askError.code : null
      return false
    } finally {
      busy.value = false
    }
  }

  /** Asks a question, and adds the answer. False when it can't be asked or wasn't answered. */
  async function send(text: string): Promise<boolean> {
    const content = text.trim()
    if (!content || content.length > MAX_LENGTH || busy.value) return false
    messages.value.push({ id: ++counter, role: 'user', content })
    return reply()
  }

  /** Asks the last question again, after it wasn't answered. */
  function retry(): Promise<boolean> {
    return busy.value ? Promise.resolve(false) : reply()
  }

  function clear(): void {
    messages.value = []
    error.value = null
    code.value = null
  }

  return { messages, busy, error, code, send, retry, clear }
})
