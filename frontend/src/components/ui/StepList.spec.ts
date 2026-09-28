import StepList from '@/components/ui/StepList.vue'
import { mountWithPlugins } from '@/test/mount'

const steps = ['Match columns', 'Review', 'Import']

async function render(props: { current: number; done?: boolean }) {
  const { wrapper } = await mountWithPlugins(StepList, { props: { steps, ...props } })
  const items = wrapper.findAll('li')
  return {
    labels: items.map((item) => item.text()),
    current: items.map((item) => item.attributes('aria-current') ?? null),
    done: items.map((item) => item.classes('step-list__step--done')),
  }
}

describe('StepList', () => {
  it('numbers the steps and marks the current one', async () => {
    const list = await render({ current: 1 })
    expect(list.labels).toEqual(['1Match columns', '2Review', '3Import'])
    expect(list.current).toEqual([null, 'step', null])
    expect(list.done).toEqual([true, false, false])
  })

  it('marks every step done at the end', async () => {
    const list = await render({ current: 2, done: true })
    expect(list.current).toEqual([null, null, null])
    expect(list.done).toEqual([true, true, true])
  })
})
