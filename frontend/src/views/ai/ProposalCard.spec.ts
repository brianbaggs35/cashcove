import { flushPromises } from '@vue/test-utils'

import * as api from '@/api/ai'
import { later } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { makeAiProposal } from '@/test/ai'
import ProposalCard from '@/views/ai/ProposalCard.vue'

async function render(proposal = makeAiProposal(), disabled = false) {
  const mounted = await mountWithPlugins(ProposalCard, { props: { proposal, disabled } })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

describe('ProposalCard', () => {
  it('shows the proposal and its pending decisions', async () => {
    const { find } = await render()

    expect(find('ai-proposal').attributes('data-state')).toBe('pending')
    expect(find('proposal-message').text()).toContain('I’ll add a monthly budget')
    expect(find('proposal-status').text()).toBe('Pending approval')
    expect(find('proposal-approve').text()).toBe('Approve')
    expect(find('proposal-reject').text()).toBe('Reject')
    expect(find('proposal-steps').text()).toContain('A monthly budget of $50.00.')
  })

  it('applies a proposal and keeps its completed state and results', async () => {
    const approved = makeAiProposal({
      state: 'approved',
      decided_at: '2026-09-20T16:00:00Z',
      results: ['Added the Coffee budget.'],
    })
    const apply = vi.spyOn(api, 'approveAiProposal').mockResolvedValue(approved)
    const { wrapper, find } = await render()

    await find('proposal-approve').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledWith('proposal-1')
    expect(wrapper.emitted('update:proposal')?.[0]?.[0]).toEqual(approved)
    await wrapper.setProps({ proposal: approved })
    expect(find('proposal-status').text()).toBe('Approved')
    expect(find('proposal-results').text()).toContain('Added the Coffee budget.')
    expect(find('proposal-approve').exists()).toBe(false)
  })

  it('turns a proposal down with context and emits it as the next chat turn', async () => {
    const rejected = makeAiProposal({
      state: 'rejected',
      decided_at: '2026-09-20T16:00:00Z',
      note: 'Make it smaller.',
    })
    const reject = vi.spyOn(api, 'rejectAiProposal').mockResolvedValue(rejected)
    const { wrapper, find } = await render()

    await find('proposal-reject').trigger('click')
    await find('proposal-reject-note').find('textarea').setValue('Make it smaller.')
    await find('proposal-reject-confirm').trigger('click')
    await flushPromises()

    expect(reject).toHaveBeenCalledWith('proposal-1', 'Make it smaller.')
    expect(wrapper.emitted('update:proposal')?.[0]?.[0]).toEqual(rejected)
    expect(wrapper.emitted('feedback')?.[0]?.[0]).toBe(
      'I turned that down. Proposed: Add the Coffee budget. Reason: Make it smaller.',
    )
    await wrapper.setProps({ proposal: rejected })
    expect(find('proposal-status').text()).toBe('Rejected')
    expect(find('proposal-note').text()).toContain('Make it smaller.')
    expect(find('proposal-reject-confirm').exists()).toBe(false)
  })

  it('allows rejecting without context and does not send an empty chat turn', async () => {
    const rejected = makeAiProposal({ state: 'rejected' })
    const reject = vi.spyOn(api, 'rejectAiProposal').mockResolvedValue(rejected)
    const { wrapper, find } = await render()

    await find('proposal-reject').trigger('click')
    await find('proposal-reject-confirm').trigger('click')
    await flushPromises()

    expect(reject).toHaveBeenCalledWith('proposal-1', null)
    expect(wrapper.emitted('feedback')).toBeUndefined()
    await wrapper.setProps({ proposal: rejected })
    expect(find('proposal-status').text()).toBe('Rejected')
  })

  it('can cancel entering rejection context', async () => {
    const reject = vi.spyOn(api, 'rejectAiProposal')
    const { find } = await render()

    await find('proposal-reject').trigger('click')
    await find('proposal-reject-note').find('textarea').setValue('Changed my mind.')
    await find('proposal-reject-cancel').trigger('click')

    expect(find('proposal-reject-note').exists()).toBe(false)
    expect(find('proposal-reject').exists()).toBe(true)
    expect(reject).not.toHaveBeenCalled()
  })

  it.each([
    ['approved', 'Approved'],
    ['rejected', 'Rejected'],
    ['expired', 'Expired'],
  ] as const)('shows the %s status without decision buttons', async (state, label) => {
    const { find } = await render(makeAiProposal({ state }))

    expect(find('proposal-status').text()).toBe(label)
    expect(find('proposal-approve').exists()).toBe(false)
    expect(find('proposal-reject').exists()).toBe(false)
  })

  it('omits empty step details', async () => {
    const { find } = await render(
      makeAiProposal({
        steps: [
          {
            tool: 'create_budget',
            title: 'Add the Coffee budget',
            summary: 'A monthly budget of $50.00.',
            details: [],
          },
        ],
      }),
    )

    expect(find('proposal-steps').text()).toContain('A monthly budget of $50.00.')
    expect(find('proposal-steps').find('ul').exists()).toBe(false)
  })

  it('shows an approval error and lets the admin try again', async () => {
    const apply = vi.spyOn(api, 'approveAiProposal').mockRejectedValue(new Error('Offline'))
    const { find } = await render()

    await find('proposal-approve').trigger('click')
    await flushPromises()

    expect(apply).toHaveBeenCalledOnce()
    expect(find('proposal-error').text()).toContain('Offline')
    expect(find('proposal-status').text()).toBe('Pending approval')
  })

  it('keeps rejection context available when the server refuses it', async () => {
    const reject = vi.spyOn(api, 'rejectAiProposal').mockRejectedValue(new Error('Offline'))
    const { find } = await render()
    await find('proposal-reject').trigger('click')
    await find('proposal-reject-note').find('textarea').setValue('Please change the amount.')

    await find('proposal-reject-confirm').trigger('click')
    await flushPromises()

    expect(reject).toHaveBeenCalledWith('proposal-1', 'Please change the amount.')
    expect(find('proposal-error').text()).toContain('Offline')
    expect(find('proposal-reject-note').find('textarea').element.value).toBe(
      'Please change the amount.',
    )
  })

  it('disables decisions when the chat is busy', async () => {
    const { find } = await render(makeAiProposal(), true)

    expect(find('proposal-approve').attributes('disabled')).toBeDefined()
    expect(find('proposal-reject').attributes('disabled')).toBeDefined()
  })

  it('disables decisions while one is being saved', async () => {
    const saving = later<ReturnType<typeof makeAiProposal>>()
    vi.spyOn(api, 'approveAiProposal').mockReturnValue(saving.promise)
    const { find } = await render()

    await find('proposal-approve').trigger('click')

    expect(find('proposal-approve').attributes('disabled')).toBeDefined()
    saving.resolve(makeAiProposal({ state: 'approved' }))
    await flushPromises()
  })
})
