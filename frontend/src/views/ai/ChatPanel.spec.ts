import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import type { AiChatReply, AiConversation, AiConversationSummary, AiProposal } from '@/api/ai'
import { ApiError } from '@/api/client'
import * as importsApi from '@/api/imports'
import type { ImportPreview } from '@/api/imports'
import { useAiStore } from '@/stores/ai'
import { MAX_LENGTH } from '@/stores/aiChat'
import { useImportWizard } from '@/stores/importWizard'
import { makeAiProposal, makeAiSettings, makeProviders, makeStatementReading } from '@/test/ai'
import { page } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { later, makeImport, makeOptions, makePreview, seedImports } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import * as dates from '@/utils/dates'
import ChatPanel from '@/views/ai/ChatPanel.vue'

function chatReply(reply: string, proposal?: AiProposal): AiChatReply {
  return {
    reply,
    conversation_id: 'conversation-1',
    ...(proposal ? { proposal } : {}),
  }
}

const savedSummary: AiConversationSummary = {
  id: 'conversation-1',
  title: 'How much on groceries?',
  created_at: '2026-09-20T12:00:00Z',
  updated_at: '2026-09-20T12:05:00Z',
  message_count: 2,
}

const savedConversation: AiConversation = {
  ...savedSummary,
  messages: [
    { role: 'user', content: 'How much on groceries?' },
    { role: 'assistant', content: 'About $84.12.' },
  ],
}

const savedProposal = makeAiProposal()
const savedConversationWithProposal: AiConversation = {
  ...savedConversation,
  messages: [
    { role: 'user', content: 'Add a Coffee budget.' },
    { role: 'assistant', content: 'I can add that.', proposal: savedProposal },
  ],
}

async function render() {
  vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
  const mounted = await mountWithPlugins(ChatPanel)
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  const input = () => find('chat-input').find('textarea')
  return { ...mounted, find, input }
}

describe('ChatPanel', () => {
  const scroll = vi.fn()

  beforeEach(() => {
    scroll.mockClear()
    window.HTMLElement.prototype.scrollIntoView = scroll
  })

  it('welcomes you with the privacy promise and questions to start from', async () => {
    const { wrapper, find } = await render()

    expect(wrapper.find('[data-test="ai-privacy"]').text()).toContain(
      'Account numbers, account names and bank names are never sent to the AI.',
    )
    expect(find('chat-history-note').text()).toContain(
      'Text questions and answers are saved on this Cashcove server until deleted.',
    )
    expect(find('chat-history-note').text()).toContain(
      "PDF statements and their extracted rows aren't saved in chat history.",
    )
    expect(find('chat-welcome').text()).toContain('Ask about your money')
    expect(find('chat-welcome').text()).toContain('Try asking')
    expect(wrapper.findAll('[data-test="chat-question"]').map((chip) => chip.text())).toEqual([
      'How much did I spend on groceries last month?',
      'What were my biggest expenses this month?',
      'Which subscriptions and bills cost the most?',
      'How am I doing against my budgets?',
      'Where could I cut back?',
    ])
    expect(find('chat-clear').attributes('disabled')).toBeDefined()
    expect(find('chat-send').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="chat-log"]').attributes('role')).toBe('log')
  })

  it('asks a suggested question, shows the answer and keeps what was being typed', async () => {
    const ask = vi
      .spyOn(api, 'askAi')
      .mockResolvedValue(
        chatReply(
          'You spent **$420.00** on groceries.\n- Whole Foods 300.00\n- Corner Market 120.00',
        ),
      )
    const { wrapper, find, input } = await render()
    await input().setValue('Something half typed')

    await wrapper.findAll('[data-test="chat-question"]')[0]!.trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledWith(
      [{ role: 'user', content: 'How much did I spend on groceries last month?' }],
      '2026-09-20',
      null,
    )
    expect(find('chat-welcome').exists()).toBe(false)
    const [asked, answered] = wrapper.findAll('[data-test="chat-message"]')
    expect(asked!.text()).toContain('How much did I spend on groceries last month?')
    expect(answered!.find('strong').text()).toBe('$420.00')
    expect(answered!.findAll('li')).toHaveLength(2)
    expect(input().element.value).toBe('Something half typed')
    expect(find('chat-clear').attributes('disabled')).toBeUndefined()
    expect(scroll).toHaveBeenCalled()
  })

  it('asks what is typed when Enter is pressed, and clears the box at once', async () => {
    const answer = later<AiChatReply>()
    const ask = vi.spyOn(api, 'askAi').mockReturnValue(answer.promise)
    const { wrapper, find, input } = await render()
    await input().setValue('What did I spend on coffee?')

    await input().trigger('keydown', { key: 'Enter' })

    expect(ask).toHaveBeenCalledTimes(1)
    expect(input().element.value).toBe('')
    // While it waits, there is a place for the answer, and nothing more can be asked.
    expect(find('chat-busy').text()).toContain('Looking at your records…')
    await input().setValue('Another?')
    expect(find('chat-send').attributes('disabled')).toBeDefined()
    await input().trigger('keydown', { key: 'Enter' })
    expect(ask).toHaveBeenCalledTimes(1)

    answer.resolve(chatReply('About 105.50.'))
    await flushPromises()

    expect(find('chat-busy').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(2)
  })

  it('asks when Send is clicked, and a new line is Shift and Enter', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Fine.'))
    const { find, input } = await render()
    await input().setValue('Line one')

    await input().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(ask).not.toHaveBeenCalled()

    expect(find('chat-send').attributes('disabled')).toBeUndefined()
    await find('chat-send').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(1)
    expect(input().element.value).toBe('')
  })

  it('asks when the form is sent some other way, such as by assistive technology', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Fine.'))
    const { find, input } = await render()
    await input().setValue('Is this sent?')

    await find('chat-form').trigger('submit')
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for an empty box', async () => {
    const ask = vi.spyOn(api, 'askAi')
    const { find, input } = await render()
    await input().setValue('   ')

    await find('chat-form').trigger('submit')
    await input().trigger('keydown', { key: 'Enter' })

    expect(ask).not.toHaveBeenCalled()
  })

  it('stops a question that is too long, and says so', async () => {
    const ask = vi.spyOn(api, 'askAi')
    const { wrapper, find, input } = await render()

    await input().setValue('x'.repeat(MAX_LENGTH + 1))

    expect(wrapper.text()).toContain('Keep it under 4,000 characters')
    expect(find('chat-send').attributes('disabled')).toBeDefined()
    await find('chat-form').trigger('submit')
    expect(ask).not.toHaveBeenCalled()
  })

  it('shows what was asked as plain text, and what was answered as the answer', async () => {
    vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Ok.'))
    const { wrapper, input } = await render()
    await input().setValue('Is **this** bold? <b>no</b>')

    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    const [asked] = wrapper.findAll('[data-test="chat-message"]')
    expect(asked!.find('strong').exists()).toBe(false)
    expect(asked!.find('b').exists()).toBe(false)
    expect(asked!.text()).toContain('Is **this** bold? <b>no</b>')
    expect(asked!.text()).toContain('You:')
  })

  it('says what went wrong, gives the question back and tries again when asked', async () => {
    const ask = vi
      .spyOn(api, 'askAi')
      .mockRejectedValueOnce(
        new ApiError(502, 'The AI didn’t answer in time.', { code: 'ai_unreachable' }),
      )
      .mockResolvedValueOnce(chatReply('Here you go.'))
    const { wrapper, find, input } = await render()
    await input().setValue('Hello?')

    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(find('chat-error').text()).toContain('The AI didn’t answer in time.')
    expect(input().element.value).toBe('Hello?')

    await find('chat-retry').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(2)
    expect(find('chat-error').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="chat-message"]').at(-1)!.text()).toContain('Here you go.')
  })

  it('keeps what was typed meanwhile rather than putting the old question back', async () => {
    const failure = later<AiChatReply>()
    vi.spyOn(api, 'askAi').mockReturnValue(failure.promise)
    const { input } = await render()
    await input().setValue('First')
    await input().trigger('keydown', { key: 'Enter' })
    await input().setValue('Second, typed while waiting')

    failure.reject(new Error('Offline'))
    await flushPromises()

    expect(input().element.value).toBe('Second, typed while waiting')
  })

  it('says when nothing was sent because something looked like account information, and offers no retry', async () => {
    vi.spyOn(api, 'askAi').mockRejectedValue(
      new ApiError(422, 'Cashcove stopped this request, and sent nothing.', { code: 'ai_blocked' }),
    )
    const { find, input } = await render()
    await input().setValue('Hello?')

    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(find('chat-error').text()).toContain('sent nothing')
    expect(find('chat-error').classes()).toContain('v-alert--variant-tonal')
    expect(find('chat-retry').exists()).toBe(false)
  })

  it('shows a proposal with its reply and keeps the approved result on the card', async () => {
    const proposal = makeAiProposal()
    const approved = makeAiProposal({
      state: 'approved',
      results: ['Added the Coffee budget.'],
    })
    vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Here is the change.', proposal))
    vi.spyOn(api, 'approveAiProposal').mockResolvedValue(approved)
    const { find, input } = await render()
    await input().setValue('Add a Coffee budget.')

    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(find('ai-proposal').text()).toContain('Add a monthly Coffee budget')
    await find('proposal-approve').trigger('click')
    await flushPromises()

    expect(find('proposal-status').text()).toBe('Approved')
    expect(find('proposal-results').text()).toContain('Added the Coffee budget.')
  })

  it('sends rejection context as the next user turn and retains both proposal cards', async () => {
    const proposal = makeAiProposal()
    const rejected = makeAiProposal({ state: 'rejected', note: 'Use a smaller amount.' })
    const nextProposal = makeAiProposal({
      id: 'proposal-2',
      title: 'Add a smaller Coffee budget',
    })
    const ask = vi
      .spyOn(api, 'askAi')
      .mockResolvedValueOnce(chatReply('Here is the change.', proposal))
      .mockResolvedValueOnce(chatReply('I changed the amount.', nextProposal))
    vi.spyOn(api, 'rejectAiProposal').mockResolvedValue(rejected)
    const { wrapper, find, input } = await render()
    await input().setValue('Add a Coffee budget.')

    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await find('proposal-reject').trigger('click')
    await find('proposal-reject-note').find('textarea').setValue('Use a smaller amount.')
    await find('proposal-reject-confirm').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: 'Add a Coffee budget.' },
        { role: 'assistant', content: 'Here is the change.' },
        {
          role: 'user',
          content:
            'I turned that down. Proposed: Add the Coffee budget. Reason: Use a smaller amount.',
        },
      ],
      '2026-09-20',
      'conversation-1',
    )
    expect(wrapper.findAll('[data-test="ai-proposal"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-test="proposal-status"]').map((item) => item.text())).toEqual([
      'Rejected',
      'Pending approval',
    ])
  })

  it('starts again with a new chat', async () => {
    vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Ok.'))
    const { wrapper, find, input } = await render()
    await input().setValue('Hello?')
    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    await find('chat-clear').trigger('click')

    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(0)
    expect(find('chat-welcome').exists()).toBe(true)
  })

  it('keeps a past chat when starting a new one and restores it from history', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('About $84.12.'))
    vi.spyOn(api, 'fetchAiConversations').mockResolvedValue([savedSummary])
    vi.spyOn(api, 'fetchAiConversation').mockResolvedValue(savedConversation)
    const { wrapper, find, input } = await render()
    await input().setValue('How much on groceries?')
    await find('chat-form').trigger('submit')
    await flushPromises()

    await find('chat-clear').trigger('click')
    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(0)

    await find('chat-history').trigger('click')
    await flushPromises()
    expect(page().find('[data-test="chat-history-list"]').exists()).toBe(true)
    expect(page().find('[data-test="chat-history-item"]').text()).toContain(
      'How much on groceries?',
    )

    await page().find('[data-test="chat-history-item"]').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(2)
    expect(find('ai-proposal').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="chat-message"]').at(-1)!.text()).toContain('About $84.12.')

    await input().setValue('What about coffee?')
    await find('chat-form').trigger('submit')
    await flushPromises()
    expect(ask).toHaveBeenLastCalledWith(
      [
        { role: 'user', content: 'How much on groceries?' },
        { role: 'assistant', content: 'About $84.12.' },
        { role: 'user', content: 'What about coffee?' },
      ],
      '2026-09-20',
      'conversation-1',
    )
  })

  it('restores a saved proposal and lets the admin reject it with a reason', async () => {
    const rejected = makeAiProposal({
      state: 'rejected',
      note: 'Please make it smaller.',
    })
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('I can adjust that.'))
    vi.spyOn(api, 'fetchAiConversations').mockResolvedValue([savedSummary])
    vi.spyOn(api, 'fetchAiConversation').mockResolvedValue(savedConversationWithProposal)
    const reject = vi.spyOn(api, 'rejectAiProposal').mockResolvedValue(rejected)
    const { find } = await render()

    await find('chat-history').trigger('click')
    await flushPromises()
    await page().find('[data-test="chat-history-item"]').trigger('click')
    await flushPromises()

    expect(find('ai-proposal').exists()).toBe(true)
    expect(find('proposal-approve').exists()).toBe(true)
    await find('proposal-reject').trigger('click')
    await find('proposal-reject-note').find('textarea').setValue('Please make it smaller.')
    await find('proposal-reject-confirm').trigger('click')
    await flushPromises()

    expect(reject).toHaveBeenCalledWith('proposal-1', 'Please make it smaller.')
    expect(ask).toHaveBeenCalledWith(
      [
        { role: 'user', content: 'Add a Coffee budget.' },
        { role: 'assistant', content: 'I can add that.' },
        {
          role: 'user',
          content:
            'I turned that down. Proposed: Add the Coffee budget. Reason: Please make it smaller.',
        },
      ],
      '2026-09-20',
      'conversation-1',
    )
    expect(find('proposal-status').text()).toBe('Rejected')
  })

  it('shows loading, reports history errors, and explains an empty history', async () => {
    const pending = later<AiConversationSummary[]>()
    const fetch = vi
      .spyOn(api, 'fetchAiConversations')
      .mockReturnValueOnce(pending.promise)
      .mockRejectedValueOnce(new Error('History could not be loaded.'))
      .mockResolvedValueOnce([])
    const { find } = await render()

    await find('chat-history').trigger('click')
    expect(page().find('[data-test="chat-history-loading"]').exists()).toBe(true)
    pending.resolve([])
    await flushPromises()
    expect(page().find('[data-test="chat-history-empty"]').text()).toContain(
      'No saved conversations yet',
    )

    await page().find('[data-test="dialog-close"]').trigger('click')
    await find('chat-history').trigger('click')
    await flushPromises()
    expect(page().find('[data-test="chat-history-error"]').text()).toBe(
      'History could not be loaded.',
    )
    expect(page().find('[data-test="chat-history-empty"]').exists()).toBe(false)

    await page().find('[data-test="dialog-close"]').trigger('click')
    await find('chat-history').trigger('click')
    await flushPromises()
    expect(page().find('[data-test="chat-history-empty"]').exists()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(3)
    await page().find('[data-test="chat-history-close"]').trigger('click')
  })

  it('asks before deleting history and removes the saved chat when confirmed', async () => {
    vi.spyOn(api, 'fetchAiConversations').mockResolvedValue([savedSummary])
    const remove = vi.spyOn(api, 'deleteAiConversation').mockResolvedValue(undefined)
    const { find } = await render()

    await find('chat-history').trigger('click')
    await flushPromises()
    await page().find('[data-test="chat-history-delete"]').trigger('click')
    expect(page().find('[data-test="chat-history-confirm"]').text()).toContain(
      'This permanently removes the saved conversation',
    )

    await page().find('[data-test="chat-history-keep"]').trigger('click')
    expect(page().find('[data-test="chat-history-item"]').exists()).toBe(true)
    await page().find('[data-test="chat-history-delete"]').trigger('click')
    await page().find('[data-test="chat-history-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('conversation-1')
    expect(page().find('[data-test="chat-history-empty"]').exists()).toBe(true)
  })

  it('keeps history open and reports a delete error so it can be retried', async () => {
    vi.spyOn(api, 'fetchAiConversations').mockResolvedValue([savedSummary])
    vi.spyOn(api, 'deleteAiConversation').mockRejectedValue(new Error('Could not delete chat.'))
    const { find } = await render()

    await find('chat-history').trigger('click')
    await flushPromises()
    await page().find('[data-test="chat-history-delete"]').trigger('click')
    await page().find('[data-test="chat-history-delete-confirm"]').trigger('click')
    await flushPromises()

    expect(page().find('[data-test="chat-history-confirm"]').exists()).toBe(true)
    expect(page().find('[data-test="chat-history-error"]').text()).toBe('Could not delete chat.')
    expect(page().find('[data-test="chat-history-item"]').exists()).toBe(false)
  })

  it('keeps the current chat visible when a saved transcript can no longer be loaded', async () => {
    vi.spyOn(api, 'fetchAiConversations').mockResolvedValue([savedSummary])
    vi.spyOn(api, 'fetchAiConversation').mockRejectedValue(new Error('This chat is gone.'))
    vi.spyOn(api, 'askAi').mockResolvedValue(chatReply('Current answer.'))
    const { wrapper, find, input } = await render()
    await input().setValue('Current question')
    await find('chat-form').trigger('submit')
    await flushPromises()

    await find('chat-history').trigger('click')
    await flushPromises()
    await page().find('[data-test="chat-history-item"]').trigger('click')
    await flushPromises()

    expect(page().find('[data-test="chat-history-error"]').text()).toBe('This chat is gone.')
    expect(page().find('[data-test="chat-history-dialog"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(2)
  })
})

describe('ChatPanel with a PDF statement', () => {
  const pdf = (name = 'september.pdf') => new File(['%PDF-1.7'], name, { type: 'application/pdf' })
  const csv = () => new File(['Date,Amount\n'], 'checking.csv', { type: 'text/csv' })
  /** What the API makes of the rows the AI read, to review before importing. */
  const statementPreview: ImportPreview = makePreview({
    format: 'pdf',
    file_name: 'september.pdf',
    options: makeOptions({ csv: null }),
    csv: null,
    balance: null,
  })
  const scroll = vi.fn()

  beforeEach(() => {
    scroll.mockClear()
    window.HTMLElement.prototype.scrollIntoView = scroll
  })

  async function renderStatements() {
    vi.spyOn(dates, 'todayIso').mockReturnValue('2026-09-20')
    const mounted = await mountWithPlugins(ChatPanel, {
      width: 1280,
      beforeMount: () => {
        seedFinance()
        seedImports()
        const ai = useAiStore()
        ai.providers = makeProviders()
        ai.settings = makeAiSettings({ review_imports: false })
      },
    })
    const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
    const input = () => find('chat-input').find('textarea')
    const dialog = () => page().find('.v-overlay--active .app-dialog')
    const picker = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    /** The file picker's own change, as the browser makes it. */
    async function choose(files: File[]) {
      const field = find('chat-file')
      Object.defineProperty(field.element, 'files', { value: files, configurable: true })
      await field.trigger('change')
      await flushPromises()
    }
    /** Something dragged over the conversation, as the browser sends it. */
    const drag = (type: string, types: string[] = ['Files'], files: File[] = [pdf()]) =>
      mounted.wrapper.find('.chat__card').trigger(type, { dataTransfer: { types, files } })
    return { ...mounted, find, input, dialog, picker, choose, drag }
  }

  /** The AI reads what it's given when a test says. */
  function reads(reading: Promise<api.StatementReading> | api.StatementReading | Error) {
    const read = vi.spyOn(api, 'readStatementWithAi')
    if (reading instanceof Error) read.mockRejectedValue(reading)
    else read.mockReturnValue(Promise.resolve(reading))
    return read
  }

  /** Waits for the PDF to be read, which takes jsdom a few turns, and sent. */
  async function sent(read: ReturnType<typeof reads>, calls = 1) {
    await vi.waitFor(() => {
      expect(read.mock.calls.length).toBeGreaterThanOrEqual(calls)
    })
    await flushPromises()
  }

  describe('reading a statement', () => {
    it('offers to read one when there’s nothing said yet, with what stays private', async () => {
      const { find, picker } = await renderStatements()

      expect(find('chat-statement-offer').text()).toContain('Read a bank statement')
      expect(find('chat-statement-offer').text()).toContain(
        'Your account numbers, name and address stay on this computer.',
      )

      await find('chat-statement-choose').trigger('click')
      await find('chat-attach').trigger('click')
      expect(picker).toHaveBeenCalledTimes(2)
      expect(find('chat-attach').attributes('aria-label')).toBe('Attach a PDF statement')
      expect(find('chat-file').attributes('accept')).toBe('.pdf,application/pdf')
    })

    it('says in the conversation that it’s reading, and what’s kept private, while the AI works', async () => {
      const reading = later<api.StatementReading>()
      const read = reads(reading.promise)
      const { wrapper, find, choose, input } = await renderStatements()

      await choose([pdf()])
      await sent(read)

      const [file, card] = wrapper.findAll('[data-test="chat-message"]')
      expect(file!.find('[data-test="chat-file-chip"]').text()).toBe('september.pdf · 1 KB')
      expect(file!.text()).toContain('You:')
      expect(card!.text()).toContain('The AI:')
      expect(find('statement-card').attributes('data-status')).toBe('reading')
      expect(find('statement-progress').text()).toContain('Reading september.pdf')
      expect(find('statement-privacy').text()).toContain(
        'Only its transaction lines go to GPT-6 Luna',
      )
      // It has its own say, so the answer to a question's dots aren't shown as well.
      expect(find('chat-busy').exists()).toBe(false)
      expect(find('chat-attach').attributes('disabled')).toBeDefined()
      expect(find('chat-statement-choose').exists()).toBe(false)
      expect(find('chat-clear').attributes('disabled')).toBeDefined()
      await input().setValue('Another?')
      expect(find('chat-send').attributes('disabled')).toBeDefined()
      expect(read).toHaveBeenCalledWith({ file_name: 'september.pdf', content: btoa('%PDF-1.7') })
      expect(scroll).toHaveBeenCalled()

      reading.resolve(makeStatementReading())
      await flushPromises()

      expect(find('statement-card').attributes('data-status')).toBe('done')
      expect(find('statement-found').text()).toBe('Found 3 transactions in september.pdf')
      expect(find('statement-details').text()).toContain('Looks like Everyday checking')
      expect(find('statement-flagged').text()).toBe('1 needs a look')
      expect(find('statement-review').text()).toBe('Review and import')
      expect(find('chat-attach').attributes('disabled')).toBeUndefined()
    })

    it('says a bigger PDF’s size in megabytes', async () => {
      const read = reads(makeStatementReading())
      const { find, choose } = await renderStatements()
      const big = new File([new Uint8Array(1.5 * 1024 * 1024)], 'year.pdf', {
        type: 'application/pdf',
      })

      await choose([big])
      await sent(read)

      expect(find('chat-file-chip').text()).toBe('year.pdf · 1.5 MB')
    })

    it('lets the reading be stopped, so something else can be asked, and be started again', async () => {
      const read = reads(new Promise<api.StatementReading>(() => undefined))
      const { find, input, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      await find('statement-cancel').trigger('click')

      expect(find('statement-stopped').text()).toBe('Stopped reading september.pdf.')
      await input().setValue('Another?')
      expect(find('chat-send').attributes('disabled')).toBeUndefined()

      read.mockResolvedValue(makeStatementReading())
      await find('statement-reread').trigger('click')
      await sent(read, 2)

      expect(find('statement-found').text()).toBe('Found 3 transactions in september.pdf')
    })

    it('says why it couldn’t read it, and tries again when asked', async () => {
      const read = reads(
        new ApiError(422, 'This PDF is a scan, so there’s no text to read.', {
          code: 'unreadable_file',
        }),
      )
      const { find, choose } = await renderStatements()

      await choose([pdf()])
      await sent(read)

      expect(find('statement-card').attributes('data-status')).toBe('failed')
      expect(find('statement-error').text()).toContain(
        'This PDF is a scan, so there’s no text to read.',
      )

      read.mockResolvedValue(makeStatementReading())
      await find('statement-reread').trigger('click')
      await sent(read, 2)

      expect(find('statement-found').exists()).toBe(true)
    })

    it('opens what the AI found for review, and says once it’s been imported', async () => {
      const read = reads(makeStatementReading())
      const previewing = later<ImportPreview>()
      vi.spyOn(importsApi, 'previewImport').mockReturnValue(previewing.promise)
      const { wrapper, find, dialog, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      await find('statement-review').trigger('click')
      // Working out what's already in the account takes a moment, which the button says.
      expect(find('statement-review').classes()).toContain('v-btn--loading')
      expect(dialog().exists()).toBe(false)

      previewing.resolve(statementPreview)
      await flushPromises()
      expect(find('statement-review').classes()).not.toContain('v-btn--loading')
      expect(dialog().find('h2').text()).toBe('Review and import')
      expect(dialog().find('[data-test="review-statement-note"]').exists()).toBe(true)

      // The import is done in the dialog; the conversation says what became of it.
      useImportWizard().record = makeImport({
        id: 'import-statement',
        file_name: 'september.pdf',
        added: 2,
      })
      await flushPromises()

      expect(find('statement-imported').text()).toContain(
        'Imported 2 transactions into Everyday checking.',
      )
      expect(find('statement-review').exists()).toBe(false)
      expect(wrapper.find('[data-test="statement-see"]').attributes('href')).toBe(
        '/transactions?import=import-statement',
      )
    })

    it('can close the review without importing, and review it again', async () => {
      const read = reads(makeStatementReading())
      vi.spyOn(importsApi, 'previewImport').mockResolvedValue(statementPreview)
      const { find, dialog, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)
      await find('statement-review').trigger('click')
      await flushPromises()
      expect(dialog().exists()).toBe(true)

      await dialog().find('[data-test="import-cancel"]').trigger('click')
      await flushPromises()

      expect(dialog().exists()).toBe(false)
      expect(find('statement-review').exists()).toBe(true)
    })

    it('says nothing about an import that wasn’t of a statement it opened', async () => {
      const read = reads(makeStatementReading())
      const { find, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      useImportWizard().record = makeImport({ id: 'import-other' })
      await flushPromises()

      expect(find('statement-imported').exists()).toBe(false)
      expect(find('statement-review').exists()).toBe(true)
    })

    it('offers another file when what it found can’t be shown, and closes to choose it', async () => {
      const read = reads(makeStatementReading())
      vi.spyOn(importsApi, 'previewImport').mockRejectedValue(new Error('Couldn’t read it.'))
      const { find, dialog, choose, picker } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      await find('statement-review').trigger('click')
      await flushPromises()
      expect(dialog().find('[data-test="import-notice"]').text()).toBe('Couldn’t read it.')

      await dialog().find('[data-test="import-choose-again"]').trigger('click')
      await flushPromises()

      expect(dialog().exists()).toBe(false)
      expect(picker).toHaveBeenCalledOnce()
    })

    it('says what to do with a file that isn’t a PDF, and takes it away when closed', async () => {
      const read = reads(makeStatementReading())
      const { wrapper, find, choose } = await renderStatements()

      await choose([csv()])

      expect(read).not.toHaveBeenCalled()
      expect(find('chat-attach-problem').text()).toContain(
        'Only a PDF statement can be read here. A CSV, OFX, QFX or QIF file goes through the Import tab.',
      )
      expect(find('chat-attach-import').attributes('href')).toBe('/import')
      expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(0)

      await find('chat-attach-problem').find('button[aria-label="Close"]').trigger('click')
      expect(find('chat-attach-problem').exists()).toBe(false)
    })

    it('takes the problem away once a PDF is chosen', async () => {
      const read = reads(makeStatementReading())
      const { find, choose } = await renderStatements()
      await choose([csv()])
      expect(find('chat-attach-problem').exists()).toBe(true)

      await choose([pdf()])
      await sent(read)

      expect(find('chat-attach-problem').exists()).toBe(false)
    })

    it('does nothing when no file is chosen', async () => {
      const read = reads(makeStatementReading())
      const { find, choose } = await renderStatements()

      await choose([])

      expect(read).not.toHaveBeenCalled()
      expect(find('chat-attach-problem').exists()).toBe(false)
    })

    it('starts again with a new chat, statements and all', async () => {
      const read = reads(makeStatementReading())
      const { wrapper, find, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      await find('chat-clear').trigger('click')

      expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(0)
      expect(find('chat-statement-offer').exists()).toBe(true)
    })

    it('reads a PDF dropped on the conversation', async () => {
      const read = reads(makeStatementReading())
      const { find, drag } = await renderStatements()

      await drag('dragenter')
      expect(find('chat-drop').text()).toBe('Drop a PDF statement to read it')
      expect(find('chat-drop').exists()).toBe(true)
      // Crossing from one of its parts to another doesn't put it away.
      await drag('dragenter')
      await drag('dragleave')
      expect(find('chat-drop').exists()).toBe(true)
      await drag('dragleave')
      expect(find('chat-drop').exists()).toBe(false)

      await drag('dragenter')
      await drag('drop')
      await sent(read)

      expect(find('chat-drop').exists()).toBe(false)
      expect(find('statement-found').exists()).toBe(true)
    })

    it('says what to do with a file that isn’t a PDF when it’s dropped, too', async () => {
      const read = reads(makeStatementReading())
      const { find, drag } = await renderStatements()

      await drag('drop', ['Files'], [csv()])

      expect(read).not.toHaveBeenCalled()
      expect(find('chat-attach-problem').exists()).toBe(true)
    })

    it('ignores a drop with no file in it, and dragging anything else over it', async () => {
      const read = reads(makeStatementReading())
      const { find, drag, wrapper } = await renderStatements()

      await drag('dragenter', ['text/plain'])
      expect(find('chat-drop').exists()).toBe(false)
      await wrapper.find('.chat__card').trigger('dragenter')
      expect(find('chat-drop').exists()).toBe(false)
      await drag('dragleave', ['text/plain'])
      await drag('drop', ['Files'], [])
      await wrapper.find('.chat__card').trigger('drop')

      expect(read).not.toHaveBeenCalled()
    })

    it('takes nothing dropped while the AI is working', async () => {
      const read = reads(new Promise<api.StatementReading>(() => undefined))
      const { find, drag, choose } = await renderStatements()
      await choose([pdf()])
      await sent(read)

      await drag('dragenter')
      expect(find('chat-drop').exists()).toBe(false)
      await drag('drop')

      expect(read).toHaveBeenCalledTimes(1)
    })

    it('lets files be dropped on it', async () => {
      const { wrapper } = await renderStatements()
      const over = new Event('dragover', { cancelable: true })

      wrapper.find('.chat__card').element.dispatchEvent(over)

      expect(over.defaultPrevented).toBe(true)
    })
  })
})
