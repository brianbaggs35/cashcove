import * as api from '@/api/ai'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { useRecommendationActions } from '@/composables/useRecommendationActions'

describe('useRecommendationActions', () => {
  beforeEach(() => {
    notices.value = []
  })

  it('applies suggestions, says how many, clears what was ticked and refreshes', async () => {
    const apply = vi
      .spyOn(api, 'applyRecommendations')
      .mockResolvedValue({ changed: 3, skipped: 0 })
    const afterwards = vi.fn().mockResolvedValue(undefined)
    const { selected, decide } = useRecommendationActions(afterwards)
    selected.value = ['a', 'b', 'c']

    await decide.run('apply', ['a', 'b', 'c'])

    expect(apply).toHaveBeenCalledWith(['a', 'b', 'c'])
    expect(notices.value.map((notice) => notice.text)).toEqual(['Applied 3 suggestions.'])
    expect(selected.value).toEqual([])
    expect(afterwards).toHaveBeenCalledTimes(1)
    expect(decide.busy.value).toBe(false)
  })

  it.each([
    [
      { changed: 1, skipped: 1 },
      'Applied 1 suggestion. 1 transaction had changed since, and was left alone.',
    ],
    [
      { changed: 2, skipped: 3 },
      'Applied 2 suggestions. 3 transactions had changed since, and were left alone.',
    ],
  ])('says when some had changed since: %j', async (result, text) => {
    vi.spyOn(api, 'applyRecommendations').mockResolvedValue(result)
    const { decide } = useRecommendationActions(() => Promise.resolve())

    await decide.run('apply', ['a'])

    expect(notices.value.map((notice) => notice.text)).toEqual([text])
  })

  it('turns suggestions down', async () => {
    const dismiss = vi
      .spyOn(api, 'dismissRecommendations')
      .mockResolvedValue({ changed: 1, skipped: 0 })
    const afterwards = vi.fn().mockResolvedValue(undefined)
    const { decide } = useRecommendationActions(afterwards)

    await decide.run('dismiss', ['a'])

    expect(dismiss).toHaveBeenCalledWith(['a'])
    expect(notices.value.map((notice) => notice.text)).toEqual(['Dismissed 1 suggestion.'])
    expect(afterwards).toHaveBeenCalledTimes(1)
  })

  it('keeps what was ticked and says what went wrong when the API refuses', async () => {
    vi.spyOn(api, 'applyRecommendations').mockRejectedValue(
      new ApiError(403, 'Only admins can do that.', { code: 'admin_only' }),
    )
    const afterwards = vi.fn()
    const { selected, decide } = useRecommendationActions(afterwards)
    selected.value = ['a']

    await decide.run('apply', ['a'])

    expect(decide.error.value).toBe('Only admins can do that.')
    expect(selected.value).toEqual(['a'])
    expect(afterwards).not.toHaveBeenCalled()
    expect(notices.value).toEqual([])
  })
})
