import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'

import {
  askAi,
  readStatementWithAi,
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
 * The conversation with the AI. It's kept for as long as the page is open, so moving between the
 * AI tab's pages doesn't lose it, and never stored anywhere.
 */
export const useAiChat = defineStore('ai-chat', () => {
  const messages = ref<ChatMessage[]>([])
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
      const answer = await askAi(recentTurns(messages.value), todayIso())
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
    error.value = null
    code.value = null
  }

  return {
    messages,
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
  }
})
