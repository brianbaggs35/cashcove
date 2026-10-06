import { effectScope, nextTick, ref } from 'vue'

import * as api from '@/api/ai'
import { POLL_INTERVAL, useReviewProgress } from '@/composables/useReviewProgress'
import { makeReview } from '@/test/ai'

/** Runs the composable in a scope of its own, which `stop` ends like unmounting would. */
function follow(
  id: Parameters<typeof useReviewProgress>[0],
  onFinished?: Parameters<typeof useReviewProgress>[1],
) {
  const scope = effectScope()
  const progress = scope.run(() => useReviewProgress(id, onFinished))!
  return {
    progress,
    stop: () => {
      scope.stop()
    },
  }
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0)
}

describe('useReviewProgress', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has no review to follow until it has an ID, and asks about none', async () => {
    const fetch = vi.spyOn(api, 'fetchAiReview')
    const { progress } = follow(null)
    await settle()

    expect(progress.review.value).toBeNull()
    expect(progress.active.value).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads a review again every moment until it has finished, and then says so once', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAiReview')
      .mockResolvedValueOnce(makeReview({ status: 'pending', reviewed: 0, open: 0 }))
      .mockResolvedValueOnce(makeReview({ status: 'running', reviewed: 6, open: 0 }))
      .mockResolvedValue(makeReview({ status: 'done' }))
    const finished = vi.fn()
    const { progress } = follow('review-1', finished)

    await settle()
    expect(progress.review.value?.status).toBe('pending')
    expect(progress.active.value).toBe(true)
    expect(finished).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect(progress.review.value).toMatchObject({ status: 'running', reviewed: 6 })
    expect(progress.active.value).toBe(true)

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)
    expect(progress.review.value?.status).toBe('done')
    expect(progress.active.value).toBe(false)
    expect(finished).toHaveBeenCalledTimes(1)
    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'done' }))

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 5)
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(finished).toHaveBeenCalledTimes(1)
  })

  it('says it has finished when a review stopped early, too', async () => {
    vi.spyOn(api, 'fetchAiReview').mockResolvedValue(makeReview({ status: 'failed', error: 'No.' }))
    const finished = vi.fn()
    follow('review-1', finished)

    await settle()

    expect(finished).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('needs no one to say when it has finished', async () => {
    vi.spyOn(api, 'fetchAiReview').mockResolvedValue(makeReview())
    const { progress } = follow('review-1')

    await settle()

    expect(progress.review.value?.status).toBe('done')
  })

  it('follows a different review when the ID changes, and lets go when it is none', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAiReview')
      .mockImplementation((id) => Promise.resolve(makeReview({ id, status: 'running' })))
    const id = ref<string | null>('review-1')
    const { progress } = follow(id)
    await settle()
    expect(progress.review.value?.id).toBe('review-1')

    id.value = 'review-2'
    await nextTick()
    await settle()
    expect(progress.review.value?.id).toBe('review-2')

    id.value = null
    await nextTick()
    await settle()
    expect(progress.review.value).toBeNull()
    const calls = fetch.mock.calls.length
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3)
    expect(fetch).toHaveBeenCalledTimes(calls)
  })

  it('only shows the latest review, whatever order the answers come back in', async () => {
    const answers: Record<string, (review: api.AiReview) => void> = {}
    vi.spyOn(api, 'fetchAiReview').mockImplementation(
      (id) => new Promise((resolve) => (answers[id] = resolve)),
    )
    const id = ref<string | null>('review-1')
    const { progress } = follow(id)
    await settle()
    id.value = 'review-2'
    await nextTick()
    await settle()

    answers['review-2']!(makeReview({ id: 'review-2', status: 'done' }))
    await settle()
    answers['review-1']!(makeReview({ id: 'review-1', status: 'running' }))
    await settle()

    expect(progress.review.value?.id).toBe('review-2')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 2)
    expect(progress.review.value?.id).toBe('review-2')
  })

  it('keeps what went wrong, and what it knew, and stops asking', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAiReview')
      .mockResolvedValueOnce(makeReview({ status: 'running' }))
      .mockRejectedValueOnce(new Error('Offline'))
    const { progress } = follow('review-1')
    await settle()

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL)

    expect(progress.error.value).toBe('Offline')
    expect(progress.review.value?.status).toBe('running')
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('can be told to look again, which clears what went wrong', async () => {
    vi.spyOn(api, 'fetchAiReview')
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue(makeReview())
    const { progress } = follow('review-1')
    await settle()
    expect(progress.error.value).toBe('Offline')

    await progress.refresh()

    expect(progress.error.value).toBeNull()
    expect(progress.review.value?.status).toBe('done')
  })

  it('ignores an error that comes back after it has moved on', async () => {
    let fail: (error: Error) => void = () => undefined
    vi.spyOn(api, 'fetchAiReview')
      .mockReturnValueOnce(new Promise((_, reject) => (fail = reject)))
      .mockResolvedValue(makeReview({ id: 'review-2' }))
    const id = ref<string | null>('review-1')
    const { progress } = follow(id)
    await settle()
    id.value = 'review-2'
    await nextTick()
    await settle()

    fail(new Error('Too late'))
    await settle()

    expect(progress.error.value).toBeNull()
    expect(progress.review.value?.id).toBe('review-2')
  })

  it('stops asking when whatever follows it is gone', async () => {
    const fetch = vi
      .spyOn(api, 'fetchAiReview')
      .mockResolvedValue(makeReview({ status: 'running' }))
    const { stop } = follow('review-1')
    await settle()

    stop()
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL * 3)

    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('doesn’t show an answer that arrives after it has gone', async () => {
    let answer: (review: api.AiReview) => void = () => undefined
    vi.spyOn(api, 'fetchAiReview').mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const finished = vi.fn()
    const { progress, stop } = follow('review-1', finished)
    await settle()

    stop()
    answer(makeReview())
    await settle()

    expect(progress.review.value).toBeNull()
    expect(finished).not.toHaveBeenCalled()
  })
})
