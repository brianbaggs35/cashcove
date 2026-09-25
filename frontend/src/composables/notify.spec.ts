import { CircleAlert, CircleCheck, Info, TriangleAlert } from '@lucide/vue'

import { notices, notify } from '@/composables/notify'

describe('notify', () => {
  it('queues messages with an icon, keeping errors up a little longer', () => {
    notify('Saved')
    notify('Failed', 'error')
    notify('Heads up', 'info')
    notify('Careful', 'warning')
    expect(
      notices.value.map(({ text, tone, icon, timeout }) => [text, tone, icon, timeout]),
    ).toEqual([
      ['Saved', 'success', CircleCheck, 4000],
      ['Failed', 'error', CircleAlert, 6000],
      ['Heads up', 'info', Info, 4000],
      ['Careful', 'warning', TriangleAlert, 4000],
    ])
    const ids = notices.value.map((notice) => notice.id)
    expect(new Set(ids).size).toBe(4)
  })
})
