import { mountWithPlugins } from '@/test/mount'
import AiProgress from '@/views/ai/AiProgress.vue'

async function render() {
  vi.useFakeTimers()
  const { wrapper } = await mountWithPlugins(AiProgress, {
    props: { working: 'Working out the filters…', privacy: 'Only the words you typed are sent.' },
  })
  const find = (name: string) => wrapper.find(`[data-test="${name}"]`)
  return { wrapper, find }
}

describe('AiProgress', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says what it is doing and what is kept private', async () => {
    const { find } = await render()

    expect(find('ai-progress-stage').text()).toBe('Working out the filters…')
    expect(find('ai-progress-privacy').text()).toBe('Only the words you typed are sent.')
    expect(find('ai-progress').find('.v-progress-circular').attributes('aria-hidden')).toBe('true')
  })

  it('says more the longer the wait gets', async () => {
    const { find } = await render()

    await vi.advanceTimersByTimeAsync(15_000)
    expect(find('ai-progress-stage').text()).toBe(
      'Still working. A slower model takes a little longer.',
    )

    await vi.advanceTimersByTimeAsync(45_000)
    expect(find('ai-progress-stage').text()).toBe(
      'Still working. A slow model can take a few minutes.',
    )
  })
})
