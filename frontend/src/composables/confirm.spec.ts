import { Trash } from '@lucide/vue'

import { confirm, confirmAndRun, confirmRequest } from '@/composables/confirm'

describe('confirm', () => {
  it('asks, and resolves with the answer', async () => {
    const answer = confirm({ title: 'Remove it?', icon: Trash, tone: 'error' })
    expect(confirmRequest.value).toMatchObject({ title: 'Remove it?', icon: Trash, tone: 'error' })
    confirmRequest.value!.resolve(true)
    await expect(answer).resolves.toBe(true)
    expect(confirmRequest.value).toBeNull()
  })

  it('declines an earlier question when a new one is asked', async () => {
    const first = confirm({ title: 'First?' })
    const second = confirm({ title: 'Second?' })
    await expect(first).resolves.toBe(false)
    expect(confirmRequest.value?.title).toBe('Second?')
    confirmRequest.value!.resolve(false)
    await expect(second).resolves.toBe(false)
  })
})

describe('confirmAndRun', () => {
  it('runs the action once confirmed and returns its result', async () => {
    const action = vi.fn().mockResolvedValue({ ended: 2 })
    const outcome = confirmAndRun({ title: 'Sign out everywhere?' }, action)
    expect(action).not.toHaveBeenCalled()
    // The dialog runs the action, then reports the confirmation.
    await confirmRequest.value!.action!()
    confirmRequest.value!.resolve(true)
    await expect(outcome).resolves.toEqual({ result: { ended: 2 } })
  })

  it('resolves to null when cancelled', async () => {
    const action = vi.fn()
    const outcome = confirmAndRun({ title: 'Remove it?' }, action)
    confirmRequest.value!.resolve(false)
    await expect(outcome).resolves.toBeNull()
    expect(action).not.toHaveBeenCalled()
  })
})
