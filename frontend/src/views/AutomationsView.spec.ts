import { flushPromises } from '@vue/test-utils'

import * as aiApi from '@/api/ai'
import * as automationsApi from '@/api/automations'
import type { Automation, AutomationSaved } from '@/api/automations'
import * as subscriptionsApi from '@/api/subscriptions'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { useAiStore } from '@/stores/ai'
import { aiOff, makeAiSettings, makeAutomationSuggestion, makeProviders } from '@/test/ai'
import { makeAutomation } from '@/test/automations'
import { answer } from '@/test/confirm'
import { seedFinance } from '@/test/finance'
import { makeSessionState, makeUser } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import { makeSubscription } from '@/test/subscriptions'
import AutomationsView from '@/views/AutomationsView.vue'

interface Options {
  role?: 'admin' | 'viewer'
  items?: Automation[]
  fail?: boolean
  pending?: boolean
  /** AI is set up, as Settings > AI does. It's off unless a test says. */
  ai?: boolean
  deferred?: {
    requests: {
      resolve: (automations: Automation[]) => void
      reject: (reason?: unknown) => void
    }[]
  }
}

async function render({
  role = 'admin',
  items = [],
  fail = false,
  pending = false,
  ai = false,
  deferred,
}: Options = {}) {
  const fetch = vi.spyOn(automationsApi, 'fetchAutomations')
  if (deferred) {
    fetch.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          deferred.requests.push({ resolve, reject })
        }),
    )
  } else if (fail)
    fetch.mockRejectedValueOnce(new Error('Temporary problem')).mockResolvedValue(items)
  else if (pending) fetch.mockReturnValue(new Promise(() => undefined))
  else fetch.mockResolvedValue(items)
  const subscriptions = vi
    .spyOn(subscriptionsApi, 'fetchSubscriptions')
    .mockResolvedValue([makeSubscription()])
  const mounted = await mountWithPlugins(AutomationsView, {
    width: 1280,
    route: '/automations',
    session: makeSessionState({ user: makeUser({ role }) }),
    beforeMount: () => {
      seedFinance()
      const store = useAiStore()
      store.providers = makeProviders()
      store.settings = ai ? makeAiSettings() : aiOff
    },
  })
  await flushPromises()
  const { wrapper } = mounted
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  const component = (name: string) => wrapper.findComponent({ name })
  return { ...mounted, fetch, subscriptions, find, component }
}

describe('AutomationsView', () => {
  it('shows the Automations header and invites admins to create their first automation', async () => {
    const { wrapper, find, component } = await render()

    expect(wrapper.find('h1').text()).toBe('Automations')
    expect(find('empty-state').text()).toContain('Let Cashcove do the sorting')
    expect(find('automation-add').exists()).toBe(false)
    await find('automation-add-first').trigger('click')
    await flushPromises()
    const dialog = component('AutomationDialog')
    expect(dialog.props()).toMatchObject({ modelValue: true, automation: null })
    dialog.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(dialog.props('modelValue')).toBe(false)
  })

  it('lists the automations as cards, and loads the subscriptions they name', async () => {
    const first = makeAutomation()
    const second = makeAutomation({ id: 'automation-rent', name: 'Rent', payees: ['Parkside'] })
    const { wrapper, subscriptions } = await render({ items: [first, second] })

    expect(wrapper.findAll('[data-test="automation-card"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-test="automation-title"]').map((title) => title.text())).toEqual([
      'Streaming',
      'Rent',
    ])
    expect(subscriptions).toHaveBeenCalledTimes(1)
  })

  it('searches names and payees, and switches between active and paused automations', async () => {
    const active = makeAutomation()
    const paused = makeAutomation({
      id: 'automation-paused',
      name: 'Old rules',
      payees: ['Old Merchant'],
      active: false,
    })
    const { find } = await render({ items: [active, paused] })

    expect(find('automation-title').text()).toBe('Streaming')
    await find('automation-search').find('input').setValue('merchant')
    await flushPromises()
    expect(find('automation-card').exists()).toBe(false)
    expect(find('automations-none-match').text()).toContain('No matches')
    await find('automation-filter').findAll('button').at(1)!.trigger('click')
    await flushPromises()
    expect(find('automation-title').text()).toBe('Old rules')
    await find('automation-search').find('input').setValue('  ')
    await flushPromises()
    expect(find('automation-title').text()).toBe('Old rules')
    await find('automation-search').find('input').setValue('OLD')
    await flushPromises()
    expect(find('automation-title').text()).toBe('Old rules')
  })

  it('opens the header action for another automation, and an automation to change', async () => {
    const automation = makeAutomation()
    const { find, component } = await render({ items: [automation] })

    await find('automation-add').trigger('click')
    await flushPromises()
    expect(component('AutomationDialog').props()).toMatchObject({
      modelValue: true,
      automation: null,
    })

    component('AutomationCard').vm.$emit('edit', automation)
    await flushPromises()
    expect(component('AutomationDialog').props()).toMatchObject({ modelValue: true, automation })
  })

  it('reloads once an automation is saved', async () => {
    const { component, fetch } = await render({ items: [makeAutomation()] })
    const saved: AutomationSaved = { ...makeAutomation(), applied: 2 }

    component('AutomationDialog').vm.$emit('saved', saved)
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('pauses an automation, and resumes it saying what that sorted', async () => {
    const automation = makeAutomation()
    const update = vi
      .spyOn(automationsApi, 'updateAutomation')
      .mockResolvedValueOnce({ ...automation, active: false, applied: 0 })
      .mockResolvedValueOnce({ ...automation, active: true, applied: 5 })
      .mockResolvedValueOnce({ ...automation, active: true, applied: 1 })
      .mockResolvedValueOnce({ ...automation, active: true, applied: 0 })
    const { component, fetch } = await render({ items: [automation] })

    component('AutomationCard').vm.$emit('toggle', automation)
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(automation.id, { active: false })
    expect(notices.value.at(-1)?.text).toBe('Paused Streaming')
    expect(fetch).toHaveBeenCalledTimes(2)

    const paused = { ...automation, active: false }
    component('AutomationCard').vm.$emit('toggle', paused)
    await flushPromises()
    expect(update).toHaveBeenLastCalledWith(automation.id, { active: true })
    expect(notices.value.at(-1)?.text).toBe('Resumed Streaming and sorted 5 transactions')

    component('AutomationCard').vm.$emit('toggle', paused)
    await flushPromises()
    expect(notices.value.at(-1)?.text).toBe('Resumed Streaming and sorted 1 transaction')

    component('AutomationCard').vm.$emit('toggle', paused)
    await flushPromises()
    expect(notices.value.at(-1)?.text).toBe('Resumed Streaming')
  })

  it('says when pausing or resuming failed', async () => {
    const automation = makeAutomation()
    vi.spyOn(automationsApi, 'updateAutomation').mockRejectedValue(new Error('No connection'))
    const { component, find } = await render({ items: [automation] })

    component('AutomationCard').vm.$emit('toggle', automation)
    await flushPromises()

    expect(find('automations-error').text()).toContain('No connection')
  })

  it('deletes after confirmation, but leaves the list alone when cancelled', async () => {
    const automation = makeAutomation()
    const remove = vi.spyOn(automationsApi, 'deleteAutomation').mockResolvedValue(undefined)
    const { component, fetch } = await render({ items: [automation] })

    component('AutomationCard').vm.$emit('delete', automation)
    await flushPromises()
    expect(confirmRequest.value?.title).toBe('Delete Streaming?')
    await answer(false)
    expect(remove).not.toHaveBeenCalled()

    component('AutomationCard').vm.$emit('delete', automation)
    await flushPromises()
    await answer(true)
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(automation.id)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(notices.value.at(-1)?.text).toBe('Deleted Streaming')
  })

  it('shows an error and tries the list again', async () => {
    const automation = makeAutomation()
    const { fetch, find } = await render({ items: [automation], fail: true })

    expect(find('automations-error').text()).toContain('Temporary problem')
    await find('automations-retry').trigger('click')
    await flushPromises()

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(find('automation-title').text()).toBe(automation.name)
    expect(find('automations-error').exists()).toBe(false)
  })

  it('ignores answers a newer request has replaced', async () => {
    const automation = makeAutomation()
    const deferred: NonNullable<Options['deferred']> = { requests: [] }
    const { component, find } = await render({ deferred })
    expect(deferred.requests).toHaveLength(1)

    const dialog = component('AutomationDialog')
    dialog.vm.$emit('saved', { ...automation, applied: 0 })
    await flushPromises()
    expect(deferred.requests).toHaveLength(2)
    deferred.requests[1]!.resolve([automation])
    await flushPromises()
    deferred.requests[0]!.resolve([])
    await flushPromises()
    expect(find('automation-title').text()).toBe(automation.name)

    dialog.vm.$emit('saved', { ...automation, applied: 0 })
    dialog.vm.$emit('saved', { ...automation, applied: 0 })
    await flushPromises()
    expect(deferred.requests).toHaveLength(4)
    deferred.requests[3]!.resolve([automation])
    await flushPromises()
    deferred.requests[2]!.reject(new Error('An obsolete request failed'))
    await flushPromises()
    expect(find('automations-error').exists()).toBe(false)
    expect(find('automation-title').text()).toBe(automation.name)
  })

  it('shows placeholders while loading, and read-only access for viewers', async () => {
    const { find, component } = await render({ role: 'viewer', pending: true })

    expect(find('automations-loading').exists()).toBe(true)
    expect(find('read-only-notice').text()).toContain('Only an admin can change them')
    expect(find('automation-add').exists()).toBe(false)
    expect(find('automation-add-first').exists()).toBe(false)
    expect(component('AutomationDialog').exists()).toBe(false)
  })

  it('shows viewers the automations without a menu on each', async () => {
    const { find } = await render({ role: 'viewer', items: [makeAutomation()] })

    expect(find('automation-title').exists()).toBe(true)
    expect(find('automation-actions').exists()).toBe(false)
  })

  it('tells viewers when there are no automations yet', async () => {
    const { find } = await render({ role: 'viewer' })

    expect(find('empty-state').text()).toContain('Let Cashcove do the sorting')
    expect(find('empty-state').find('button').exists()).toBe(false)
  })
})

describe('AutomationsView, suggesting automations with AI', () => {
  const one = makeAutomation()

  it('has no way to, and says nothing of AI, until AI is set up', async () => {
    const { find } = await render({ items: [one] })

    expect(find('automation-suggest').exists()).toBe(false)
    const empty = await render()
    expect(empty.find('automation-suggest-first').exists()).toBe(false)
  })

  it('has no way to for a viewer, who can’t make an automation from it', async () => {
    const { find, component } = await render({ items: [one], ai: true, role: 'viewer' })

    expect(find('automation-suggest').exists()).toBe(false)
    expect(component('AutomationSuggestions').exists()).toBe(false)
  })

  it('offers it beside making an automation, and opens what the AI suggests', async () => {
    const ask = vi
      .spyOn(aiApi, 'suggestAutomationsWithAi')
      .mockResolvedValue({ suggestions: [makeAutomationSuggestion()], considered: 1 })
    const { find, component } = await render({ items: [one], ai: true })

    await find('automation-suggest').trigger('click')
    await flushPromises()

    expect(ask).toHaveBeenCalledOnce()
    expect(component('AutomationSuggestions').props('modelValue')).toBe(true)

    component('AutomationSuggestions').vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(component('AutomationSuggestions').props('modelValue')).toBe(false)
  })

  it('offers it as a way to start when there are no automations yet', async () => {
    vi.spyOn(aiApi, 'suggestAutomationsWithAi').mockResolvedValue({
      suggestions: [],
      considered: 0,
    })
    const { find, component } = await render({ ai: true })

    expect(find('automation-add-first').exists()).toBe(true)
    await find('automation-suggest-first').trigger('click')
    await flushPromises()

    expect(component('AutomationSuggestions').props('modelValue')).toBe(true)
  })

  it('loads the list again once one is made from a suggestion', async () => {
    vi.spyOn(aiApi, 'suggestAutomationsWithAi').mockResolvedValue({
      suggestions: [makeAutomationSuggestion()],
      considered: 1,
    })
    const { fetch, find, component } = await render({ items: [one], ai: true })
    await find('automation-suggest').trigger('click')
    await flushPromises()
    fetch.mockClear()

    component('AutomationSuggestions').vm.$emit('created', { ...one, applied: 2 })
    await flushPromises()

    expect(fetch).toHaveBeenCalledOnce()
  })
})
