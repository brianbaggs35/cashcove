import type { AutomationSuggestion } from '@/api/ai'
import { makeAutomationSuggestion } from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import { formatListDate } from '@/utils/dates'
import AutomationSuggestionCard from '@/views/automations/AutomationSuggestionCard.vue'

async function render(changes: Partial<AutomationSuggestion> = {}, created = false) {
  const mounted = await mountWithPlugins(AutomationSuggestionCard, {
    width: 1280,
    props: { suggestion: makeAutomationSuggestion(changes), created },
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('AutomationSuggestionCard', () => {
  it('says what it looks for and what it gives, in a sentence', async () => {
    const { find } = await render()

    expect(find('suggestion-name').text()).toBe('Whole Foods')
    expect(find('suggestion-rule').text()).toContain('Payee starts with “WHOLEFDS MKT”, money out')
    expect(find('suggestion-rule').text()).toContain('Puts them in')
    expect(find('suggestion-rule').find('[data-test="category-chip"]').text()).toContain(
      'Groceries',
    )
  })

  it('says how it compares, and for either way the money went leaves that out', async () => {
    const { find } = await render({
      match: 'contains',
      direction: 'any',
      payees: ['Netflix', 'Hulu'],
    })

    expect(find('suggestion-rule').text()).toContain('Payee contains “Netflix”, “Hulu”')
    expect(find('suggestion-rule').text()).not.toContain('money')
  })

  it('says money in for a paycheck', async () => {
    const { find } = await render({ direction: 'in' })

    expect(find('suggestion-rule').text()).toContain('“WHOLEFDS MKT”, money in')
  })

  it('says how many times the category was chosen, and when last', async () => {
    const { find } = await render({ choices: 6, last_chosen: '2025-03-04' })

    expect(find('suggestion-evidence').text()).toContain(
      `Chosen 6 times, the last on ${formatListDate('2025-03-04', 'en-US')}`,
    )
  })

  it.each([
    [2, 'Would sort 2 transactions with no category now'],
    [1, 'Would sort 1 transaction with no category now'],
    [0, 'Nothing is waiting to be sorted, but it would sort what comes next'],
  ])('says what it would sort now when that is %i', async (sorts_now, words) => {
    const { find } = await render({ sorts_now })

    expect(find('suggestion-evidence').text()).toContain(words)
  })

  it('says how much it matches that was put elsewhere, and leaves alone', async () => {
    const none = await render({ elsewhere: 0 })
    expect(none.find('suggestion-elsewhere').exists()).toBe(false)
    none.wrapper.unmount()

    const one = await render({ elsewhere: 1 })
    expect(one.find('suggestion-elsewhere').text()).toBe(
      '1 other transaction you put in another category would stay as you chose',
    )
    one.wrapper.unmount()

    const some = await render({ elsewhere: 3 })
    expect(some.find('suggestion-elsewhere').text()).toBe(
      '3 other transactions you put in another category would stay as you chose',
    )
  })

  it('gives the AI’s reason when it had one', async () => {
    const { find } = await render({ reason: 'Every one begins with it.' })
    expect(find('suggestion-reason').text()).toBe('Every one begins with it.')

    const without = await render({ reason: '' })
    expect(without.find('suggestion-reason').exists()).toBe(false)
  })

  it('warns that an older automation already sorts some of it, and goes first', async () => {
    const none = await render()
    expect(none.find('suggestion-overlap').exists()).toBe(false)
    none.wrapper.unmount()

    const one = await render({
      overlaps: [
        { automation_id: 'automation-1', automation_name: 'Everything is coffee', count: 4 },
      ],
    })
    expect(one.find('suggestion-overlap').text()).toBe(
      'Everything is coffee already sorts some of these, and goes first.',
    )
    one.wrapper.unmount()

    const two = await render({
      overlaps: [
        { automation_id: 'automation-1', automation_name: 'Coffee', count: 4 },
        { automation_id: 'automation-2', automation_name: 'Treats', count: 1 },
      ],
    })
    expect(two.find('suggestion-overlap').text()).toBe(
      'Coffee and Treats already sort some of these, and go first.',
    )
  })

  it('can be made into an automation, or put aside', async () => {
    const { wrapper, find } = await render()

    await find('suggestion-create').trigger('click')
    await find('suggestion-skip').trigger('click')

    expect(wrapper.emitted('create')).toHaveLength(1)
    expect(wrapper.emitted('skip')).toHaveLength(1)
    expect(find('suggestion-created').exists()).toBe(false)
  })

  it('says so, with nothing more to do, once it has been made', async () => {
    const { find } = await render({}, true)

    expect(find('suggestion-created').text()).toBe('Created')
    expect(find('suggestion-create').exists()).toBe(false)
    expect(find('suggestion-skip').exists()).toBe(false)
  })
})
