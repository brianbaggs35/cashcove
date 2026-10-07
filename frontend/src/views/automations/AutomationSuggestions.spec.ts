import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as aiApi from '@/api/ai'
import type { AutomationSuggestions } from '@/api/ai'
import * as automationsApi from '@/api/automations'
import * as billsApi from '@/api/bills'
import * as budgetApi from '@/api/budget'
import { ApiError } from '@/api/client'
import * as subscriptionsApi from '@/api/subscriptions'
import * as transactionsApi from '@/api/transactions'
import { useAiStore } from '@/stores/ai'
import { makeAiSettings, makeAutomationSuggestion, makeProviders } from '@/test/ai'
import { makeAutomation } from '@/test/automations'
import { page } from '@/test/dom'
import { makePage, seedFinance } from '@/test/finance'
import { later } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import AutomationSuggestionsDialog from '@/views/automations/AutomationSuggestions.vue'

const two = makeAutomationSuggestion({ ref: 'g2', name: 'Netflix', payees: ['NETFLIX'] })
const found: AutomationSuggestions = {
  suggestions: [makeAutomationSuggestion(), two],
  considered: 3,
}

async function render(
  answer: Promise<AutomationSuggestions> | AutomationSuggestions | Error = found,
) {
  const ask = vi.spyOn(aiApi, 'suggestAutomationsWithAi')
  if (answer instanceof Error) ask.mockRejectedValue(answer)
  else ask.mockReturnValue(Promise.resolve(answer))
  // What the form for a new automation loads when a suggestion is made into one.
  vi.spyOn(transactionsApi, 'fetchTransactions').mockResolvedValue(makePage([]))
  vi.spyOn(subscriptionsApi, 'fetchSubscriptions').mockResolvedValue([])
  vi.spyOn(billsApi, 'fetchBills').mockResolvedValue([])
  vi.spyOn(budgetApi, 'fetchBudgets').mockResolvedValue([])
  vi.spyOn(automationsApi, 'previewAutomation').mockResolvedValue({ matching: 4, overlaps: [] })
  const open = ref(false)
  const created = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(AutomationSuggestionsDialog, {
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onCreated: created,
      }),
  })
  const mounted = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      seedFinance()
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = makeAiSettings()
    },
  })
  const dialog = () => page().find('.v-overlay--active .app-dialog')
  const find = (name: string) => dialog().find(`[data-test="${name}"]`)
  const cards = () => dialog().findAll('[data-test="automation-suggestion"]')
  /** Opens it, which has the AI look. */
  const show = async () => {
    open.value = true
    await flushPromises()
  }
  return { ...mounted, ask, open, created, dialog, find, cards, show }
}

describe('AutomationSuggestions', () => {
  it('asks nothing until it is opened, and then looks', async () => {
    const { ask, show, dialog } = await render()
    expect(ask).not.toHaveBeenCalled()

    await show()

    expect(ask).toHaveBeenCalledOnce()
    expect(dialog().find('h2').text()).toBe('Suggested automations')
    expect(dialog().text()).toContain('Nothing is created until you save it.')
  })

  it('says it is looking, and what stays private, while the AI works', async () => {
    const answer = later<AutomationSuggestions>()
    const { find, show } = await render(answer.promise)

    await show()

    expect(find('ai-progress-stage').text()).toBe('Looking at the categories you chose by hand…')
    expect(find('ai-progress-privacy').text()).toBe(
      'Only each payee as it is written, with account details taken out, your category names and how often you chose them go to GPT-6 Luna.',
    )
    expect(find('suggestions-close').text()).toBe('Cancel')
    expect(find('suggestions-again').exists()).toBe(false)

    answer.resolve(found)
    await flushPromises()
    expect(find('suggestions-working').exists()).toBe(false)
    expect(find('suggestions-close').text()).toBe('Close')
  })

  it('says the AI when it doesn’t know which model it is', async () => {
    const { find, show } = await render(later<AutomationSuggestions>().promise)
    useAiStore().settings = makeAiSettings({ model: null })

    await show()

    expect(find('ai-progress-privacy').text()).toContain('how often you chose them go to the AI.')
  })

  it('lists what it suggests, and how many payees it came from', async () => {
    const { find, cards, show } = await render()

    await show()

    expect(find('suggestions-summary').text()).toBe(
      '2 suggestions from 3 payees you sorted by hand.',
    )
    expect(cards().map((card) => card.find('[data-test="suggestion-name"]').text())).toEqual([
      'Whole Foods',
      'Netflix',
    ])
  })

  it('says it is one suggestion from one payee in the singular', async () => {
    const { find, show } = await render({
      suggestions: [makeAutomationSuggestion()],
      considered: 1,
    })

    await show()

    expect(find('suggestions-summary').text()).toBe('1 suggestion from 1 payee you sorted by hand.')
  })

  it('says what makes an automation suggested when no payee has had a category chosen enough', async () => {
    const { find, show } = await render({ suggestions: [], considered: 0 })

    await show()

    expect(find('suggestions-none').text()).toContain('Nothing to suggest yet')
    expect(find('suggestions-none').text()).toContain('three times')
  })

  it('says no rule fit when payees were looked at but none had text in common', async () => {
    const { find, show } = await render({ suggestions: [], considered: 4 })

    await show()

    expect(find('suggestions-no-rule').text()).toContain(
      'The AI looked at 4 payees you chose a category for, and none had text that all of them share.',
    )
  })

  it('says why it failed, and looks again when asked', async () => {
    const { ask, find, show } = await render(
      new ApiError(502, 'The AI didn’t answer in time.', { code: 'ai_unreachable' }),
    )
    await show()
    expect(find('suggestions-error').text()).toBe('The AI didn’t answer in time.')

    ask.mockResolvedValue(found)
    await find('suggestions-again').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledTimes(2)
    expect(find('suggestions-error').exists()).toBe(false)
    expect(find('suggestions-summary').exists()).toBe(true)
  })

  it('puts a suggestion aside, and says when that was all of them', async () => {
    const { find, cards, show } = await render()
    await show()

    await cards()[0]!.find('[data-test="suggestion-skip"]').trigger('click')
    expect(cards()).toHaveLength(1)
    expect(find('suggestions-done').exists()).toBe(false)

    await cards()[0]!.find('[data-test="suggestion-skip"]').trigger('click')
    expect(cards()).toHaveLength(0)
    expect(find('suggestions-done').text()).toBe('That’s all of them.')
  })

  it('opens the form for a new automation with the suggestion in it', async () => {
    const { find, cards, show } = await render()
    await show()

    await cards()[0]!.find('[data-test="suggestion-create"]').trigger('click')
    await flushPromises()

    const form = page().find('[data-test="automation-dialog"]')
    expect(form.exists()).toBe(true)
    expect(form.find('h2').text()).toBe('New automation')
    expect(form.find('[data-test="automation-name"] input').element).toHaveProperty(
      'value',
      'Whole Foods',
    )
    expect(find('suggestions-summary').exists()).toBe(true)
  })

  it('says it was created, and tells the page, once the form is saved', async () => {
    const { wrapper, find, cards, created, show } = await render()
    await show()
    await cards()[0]!.find('[data-test="suggestion-create"]').trigger('click')
    await flushPromises()
    const saved = { ...makeAutomation(), applied: 2 }

    wrapper.findComponent({ name: 'AutomationDialog' }).vm.$emit('saved', saved)
    await flushPromises()

    expect(created).toHaveBeenCalledWith(saved)
    expect(cards()[0]!.find('[data-test="suggestion-created"]').exists()).toBe(true)
    expect(cards()[1]!.find('[data-test="suggestion-created"]').exists()).toBe(false)
    expect(find('suggestions-summary').exists()).toBe(true)
  })

  it('forgets what was put aside or made when it looks again', async () => {
    const { wrapper, find, cards, show } = await render()
    await show()
    await cards()[0]!.find('[data-test="suggestion-skip"]').trigger('click')
    await cards()[0]!.find('[data-test="suggestion-create"]').trigger('click')
    await flushPromises()
    wrapper.findComponent({ name: 'AutomationDialog' }).vm.$emit('saved', makeAutomation())
    await flushPromises()

    await find('suggestions-again').trigger('click')
    await flushPromises()

    expect(cards()).toHaveLength(2)
    expect(dialogCreated(cards())).toBe(0)
  })

  it('has no automation to say was made when the form is saved with none being made', async () => {
    const { wrapper, created, cards, show } = await render()
    await show()

    wrapper.findComponent({ name: 'AutomationDialog' }).vm.$emit('saved', makeAutomation())
    await flushPromises()

    expect(created).toHaveBeenCalledOnce()
    expect(dialogCreated(cards())).toBe(0)
  })

  it('ignores what comes back after it was closed, and looks afresh when opened again', async () => {
    const first = later<AutomationSuggestions>()
    const { ask, open, find, show } = await render(first.promise)
    await show()

    open.value = false
    await flushPromises()
    first.resolve(found)
    await flushPromises()
    ask.mockResolvedValue({ suggestions: [two], considered: 1 })
    await show()

    expect(ask).toHaveBeenCalledTimes(2)
    expect(find('suggestions-summary').text()).toBe('1 suggestion from 1 payee you sorted by hand.')
  })

  it('ignores a failure that came after it was closed', async () => {
    const first = later<AutomationSuggestions>()
    const { open, ask, find, show } = await render(first.promise)
    await show()
    ask.mockResolvedValue(found)

    open.value = false
    await flushPromises()
    first.reject(new Error('Offline'))
    await flushPromises()
    await show()

    expect(find('suggestions-error').exists()).toBe(false)
  })

  it('closes from its own button, and from the dialog’s', async () => {
    const { open, find, show } = await render()
    await show()

    await find('suggestions-close').trigger('click')
    expect(open.value).toBe(false)

    await show()
    await find('dialog-close').trigger('click')
    expect(open.value).toBe(false)
  })

  it('puts the form away when it closes by itself, with the suggestion still to make', async () => {
    const { wrapper, find, cards, show } = await render()
    await show()
    await cards()[0]!.find('[data-test="suggestion-create"]').trigger('click')
    await flushPromises()

    await page()
      .find('[data-test="automation-dialog"]')
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    await flushPromises()

    expect(wrapper.findComponent({ name: 'AutomationDialog' }).props('modelValue')).toBe(false)
    expect(cards()[0]!.find('[data-test="suggestion-create"]').exists()).toBe(true)
    expect(find('suggestions-summary').exists()).toBe(true)
  })
})

/** How many of the cards say they were made. */
function dialogCreated(cards: ReturnType<ReturnType<typeof page>['findAll']>): number {
  return cards.filter((card) => card.find('[data-test="suggestion-created"]').exists()).length
}
