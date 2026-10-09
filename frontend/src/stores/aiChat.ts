import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import {
  askAi,
  deleteAiConversation,
  fetchAiConversation,
  fetchAiConversations,
  readStatementWithAi,
  type AiConversationSummary,
  type AiProposal,
  type ChatTurn,
  type StatementReading,
} from '@/api/ai'
import { ApiError, errorMessage } from '@/api/client'
import type { FileImport } from '@/api/imports'
import { todayIso } from '@/utils/dates'
import { readPdf } from '@/views/import/statement'

/** Something said in words, by the person or by the AI. */
export interface TextMessage extends ChatTurn {
  kind: 'text'
  id: number
  proposal?: AiProposal
}

/** A statement the person attached. */
export interface FileMessage {
  kind: 'file'
  id: number
  role: 'user'
  name: string
  size: number
}

export type StatementStatus = 'reading' | 'done' | 'failed' | 'cancelled'

/** What became of an attached statement: being read, what was found, or why it wasn't. */
export interface StatementMessage {
  kind: 'statement'
  id: number
  role: 'assistant'
  /** Kept to read it again. */
  file: File
  status: StatementStatus
  reading: StatementReading | null
  error: string | null
  /** What importing what was found added, once it has. */
  imported: FileImport | null
}

export type ChatMessage = TextMessage | FileMessage | StatementMessage

/** The most turns the API takes at once; the oldest are left out of a longer conversation. */
export const MAX_TURNS = 24
/** The longest message the API takes. */
export const MAX_LENGTH = 4000

/**
 * The turns to send: the latest ones said in words, starting with a question, since a
 * conversation that starts with an answer makes no sense to some providers. A statement is
 * never part of it: what the AI reads of one is sent apart, with names and numbers taken out.
 */
export function recentTurns(messages: readonly ChatMessage[]): ChatTurn[] {
  const turns = messages
    .filter((message): message is TextMessage => message.kind === 'text')
    .slice(-MAX_TURNS)
    .map(({ role, content }) => ({ role, content }))
  const first = turns.findIndex((turn) => turn.role === 'user')
  return first < 0 ? [] : turns.slice(first)
}

/**
 * The current conversation with the AI, and its saved text history. Uploaded statement files and
 * their extracted rows stay in the current page only and are never added to the history.
 */
export const useAiChat = defineStore('ai-chat', () => {
  const messages = ref<ChatMessage[]>([])
  const conversationId = ref<string | null>(null)
  const history = ref<AiConversationSummary[]>([])
  const historyLoading = ref(false)
  const historyError = ref<string | null>(null)
  /** The AI is working, on an answer or on reading a statement. */
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** The API's code for what went wrong, e.g. `ai_blocked` when nothing was sent. */
  const code = ref<string | null>(null)
  let counter = 0

  /** A statement is being read, which says so itself, where a question gets the dots. */
  const reading = computed(() =>
    messages.value.some((message) => message.kind === 'statement' && message.status === 'reading'),
  )

  async function reply(): Promise<boolean> {
    busy.value = true
    error.value = null
    code.value = null
    try {
      const answer = await askAi(recentTurns(messages.value), todayIso(), conversationId.value)
      conversationId.value = answer.conversation_id
      const message: TextMessage = {
        kind: 'text',
        id: ++counter,
        role: 'assistant',
        content: answer.reply,
      }
      if (answer.proposal) message.proposal = answer.proposal
      messages.value.push(message)
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
    messages.value.push({ kind: 'text', id: ++counter, role: 'user', content })
    return reply()
  }

  /** Asks the last question again, after it wasn't answered. */
  function retry(): Promise<boolean> {
    return busy.value ? Promise.resolve(false) : reply()
  }

  /** Has the AI read the statement, and says what it found or why it couldn't. */
  async function read(message: StatementMessage): Promise<StatementMessage | null> {
    busy.value = true
    error.value = null
    code.value = null
    message.status = 'reading'
    message.error = null
    // Stopped meanwhile: the answer, when it comes, isn't wanted.
    const stopped = () => message.status === 'cancelled'
    try {
      const reading = await readStatementWithAi(await readPdf(message.file))
      if (stopped()) return null
      message.reading = reading
      message.status = 'done'
      return message
    } catch (readError) {
      if (stopped()) return null
      message.status = 'failed'
      message.error = errorMessage(readError)
      return null
    } finally {
      // Stopping it freed the chat for a question, which a late answer mustn't undo.
      if (!stopped()) busy.value = false
    }
  }

  /** Attaches a PDF statement to the conversation and has the AI read it. */
  function attach(file: File): Promise<StatementMessage | null> {
    if (busy.value) return Promise.resolve(null)
    messages.value.push(
      { kind: 'file', id: ++counter, role: 'user', name: file.name, size: file.size },
      {
        kind: 'statement',
        id: ++counter,
        role: 'assistant',
        file: markRaw(file),
        status: 'reading',
        reading: null,
        error: null,
        imported: null,
      },
    )
    return read(messages.value.at(-1) as StatementMessage)
  }

  /** Reads a statement again, after it failed or was stopped. */
  function reread(message: StatementMessage): Promise<StatementMessage | null> {
    return busy.value ? Promise.resolve(null) : read(message)
  }

  /** Stops waiting for the statement being read, so something else can be asked. */
  function cancel(): void {
    const message = messages.value.find(
      (item): item is StatementMessage => item.kind === 'statement' && item.status === 'reading',
    )
    if (!message) return
    message.status = 'cancelled'
    busy.value = false
  }

  /** Remembers what importing a statement's transactions added. */
  function imported(id: number, record: FileImport): void {
    const message = messages.value.find((item) => item.kind === 'statement' && item.id === id)
    if (message?.kind === 'statement') message.imported = record
  }

  function clear(): void {
    messages.value = []
    conversationId.value = null
    error.value = null
    code.value = null
    historyError.value = null
  }

  async function loadHistory(): Promise<void> {
    historyLoading.value = true
    historyError.value = null
    try {
      history.value = await fetchAiConversations()
    } catch (loadError) {
      historyError.value = errorMessage(loadError)
    } finally {
      historyLoading.value = false
    }
  }

  async function restore(id: string): Promise<boolean> {
    historyLoading.value = true
    historyError.value = null
    try {
      const saved = await fetchAiConversation(id)
      messages.value = saved.messages.map(({ role, content, proposal }) => {
        const message: TextMessage = {
          kind: 'text',
          id: ++counter,
          role,
          content,
        }
        if (proposal) message.proposal = proposal
        return message
      })
      conversationId.value = saved.id
      error.value = null
      code.value = null
      return true
    } catch (loadError) {
      historyError.value = errorMessage(loadError)
      return false
    } finally {
      historyLoading.value = false
    }
  }

  async function deleteHistory(id: string): Promise<boolean> {
    historyLoading.value = true
    historyError.value = null
    try {
      await deleteAiConversation(id)
      history.value = history.value.filter((conversation) => conversation.id !== id)
      if (conversationId.value === id) clear()
      return true
    } catch (deleteError) {
      historyError.value = errorMessage(deleteError)
      return false
    } finally {
      historyLoading.value = false
    }
  }

  return {
    messages,
    conversationId,
    history,
    historyLoading,
    historyError,
    busy,
    reading,
    error,
    code,
    send,
    retry,
    attach,
    reread,
    cancel,
    imported,
    clear,
    loadHistory,
    restore,
    deleteHistory,
  }
})
