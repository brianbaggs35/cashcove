import { mount } from '@vue/test-utils'

import { buildVuetify } from '@/plugins/vuetify'
import { track } from '@/test/cleanup'
import StatementProgress from '@/views/import/StatementProgress.vue'

function render(model: string | null = 'GPT-6 Luna') {
  const wrapper = mount(StatementProgress, {
    props: { fileName: 'september.pdf', model },
    global: { plugins: [buildVuetify()] },
  })
  track(wrapper)
  return wrapper
}

describe('StatementProgress', () => {
  beforeEach(() => vi.useFakeTimers())

  it('says what is being read, what is happening and what stays private', () => {
    const wrapper = render()

    expect(wrapper.text()).toContain('Reading september.pdf')
    expect(wrapper.find('[data-test="statement-stage"]').text()).toBe(
      'Taking the transactions off the statement…',
    )
    expect(wrapper.find('[data-test="statement-privacy"]').text()).toContain(
      'The PDF is read on this computer. Only its transaction lines go to GPT-6 Luna, with names, numbers and addresses hidden.',
    )
    // Moving, so nobody wonders whether it's stuck.
    expect(wrapper.find('.v-progress-linear').exists()).toBe(true)
    expect(wrapper.find('.v-progress-circular').exists()).toBe(true)
  })

  it('says more the longer the wait gets', async () => {
    const wrapper = render()
    const stage = () => wrapper.find('[data-test="statement-stage"]').text()

    await vi.advanceTimersByTimeAsync(14_000)
    expect(stage()).toBe('Taking the transactions off the statement…')
    await vi.advanceTimersByTimeAsync(1000)
    expect(stage()).toBe('Still reading. A longer statement takes a little longer.')
    await vi.advanceTimersByTimeAsync(45_000)
    expect(stage()).toBe('Still working. A slow model can take a few minutes.')
  })

  it('says “the AI” when it doesn’t know which model', () => {
    const wrapper = render(null)

    expect(wrapper.find('[data-test="statement-privacy"]').text()).toContain(
      'Only its transaction lines go to the AI,',
    )
  })

  it('stops counting when it goes away', () => {
    const wrapper = render()

    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
