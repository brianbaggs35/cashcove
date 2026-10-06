import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { MAX_LENGTH } from '@/stores/aiChat'
import { mountWithPlugins } from '@/test/mount'
import * as dates from '@/utils/dates'
import ChatPanel from '@/views/ai/ChatPanel.vue'

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
    expect(find('chat-welcome').text()).toContain('Ask about your money')
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
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue({
      reply: 'You spent **$420.00** on groceries.\n- Whole Foods 300.00\n- Corner Market 120.00',
    })
    const { wrapper, find, input } = await render()
    await input().setValue('Something half typed')

    await wrapper.findAll('[data-test="chat-question"]')[0]!.trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledWith(
      [{ role: 'user', content: 'How much did I spend on groceries last month?' }],
      '2026-09-20',
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
    let answer: (value: { reply: string }) => void = () => undefined
    const ask = vi.spyOn(api, 'askAi').mockReturnValue(new Promise((resolve) => (answer = resolve)))
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

    answer({ reply: 'About 105.50.' })
    await flushPromises()

    expect(find('chat-busy').exists()).toBe(false)
    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(2)
  })

  it('asks when the form is sent, and a new line is Shift and Enter', async () => {
    const ask = vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'Fine.' })
    const { find, input } = await render()
    await input().setValue('Line one')

    await input().trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(ask).not.toHaveBeenCalled()

    expect(find('chat-send').attributes('disabled')).toBeUndefined()
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
    vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'Ok.' })
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
      .mockResolvedValueOnce({ reply: 'Here you go.' })
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
    let fail: (error: Error) => void = () => undefined
    vi.spyOn(api, 'askAi').mockReturnValue(new Promise((_, reject) => (fail = reject)))
    const { input } = await render()
    await input().setValue('First')
    await input().trigger('keydown', { key: 'Enter' })
    await input().setValue('Second, typed while waiting')

    fail(new Error('Offline'))
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

  it('starts again with a new chat', async () => {
    vi.spyOn(api, 'askAi').mockResolvedValue({ reply: 'Ok.' })
    const { wrapper, find, input } = await render()
    await input().setValue('Hello?')
    await input().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    await find('chat-clear').trigger('click')

    expect(wrapper.findAll('[data-test="chat-message"]')).toHaveLength(0)
    expect(find('chat-welcome').exists()).toBe(true)
  })
})
