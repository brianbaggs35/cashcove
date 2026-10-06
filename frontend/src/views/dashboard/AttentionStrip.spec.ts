import { useConnectionsStore } from '@/stores/connections'
import { fidelity, makeConnection } from '@/test/connections'
import { mountWithPlugins } from '@/test/mount'
import AttentionStrip from '@/views/dashboard/AttentionStrip.vue'

async function render(uncategorized: number, connections = [fidelity], aiRecommendations = 0) {
  const { wrapper } = await mountWithPlugins(AttentionStrip, {
    props: { uncategorized, aiRecommendations },
    beforeMount: () => {
      useConnectionsStore().connections = connections
    },
  })
  return wrapper
}

describe('AttentionStrip', () => {
  it('points out banks that need attention and transactions with no category', async () => {
    const wrapper = await render(4)

    expect(wrapper.find('[data-test="attention-banks"]').text()).toContain(
      '1 bank needs attention.',
    )
    expect(wrapper.find('[data-test="attention-connect"]').attributes('href')).toBe('/connect')
    expect(wrapper.find('[data-test="attention-uncategorized"]').text()).toContain(
      '4 transactions have no category yet.',
    )
    expect(wrapper.find('[data-test="attention-review"]').attributes('href')).toBe(
      '/transactions?category=none',
    )
  })

  it('says it in the singular, and counts every bank', async () => {
    const wrapper = await render(1, [fidelity, makeConnection({ id: 'c2', status: 'error' })])

    expect(wrapper.find('[data-test="attention-banks"]').text()).toContain(
      '2 banks need attention.',
    )
    expect(wrapper.find('[data-test="attention-uncategorized"]').text()).toContain(
      '1 transaction has no category yet.',
    )
  })

  it('has nothing to say when nothing needs attention', async () => {
    const wrapper = await render(0, [])

    expect(wrapper.find('[data-test="attention"]').exists()).toBe(false)
  })

  it('can have only one of the two to say', async () => {
    const onlyBanks = await render(0)
    expect(onlyBanks.find('[data-test="attention-banks"]').exists()).toBe(true)
    expect(onlyBanks.find('[data-test="attention-uncategorized"]').exists()).toBe(false)

    const onlyCategories = await render(2, [])
    expect(onlyCategories.find('[data-test="attention-banks"]').exists()).toBe(false)
    expect(onlyCategories.find('[data-test="attention-uncategorized"]').exists()).toBe(true)
  })

  describe('what the AI suggested', () => {
    it('says how many suggestions are waiting, and where to look at them', async () => {
      const wrapper = await render(0, [], 3)

      expect(wrapper.find('[data-test="attention"]').exists()).toBe(true)
      expect(wrapper.find('[data-test="attention-ai"]').text()).toContain(
        'The AI has 3 suggestions for how your transactions are sorted.',
      )
      expect(wrapper.find('[data-test="attention-ai-review"]').attributes('href')).toBe(
        '/ai/recommendations',
      )
      expect(wrapper.find('[data-test="attention-banks"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="attention-uncategorized"]').exists()).toBe(false)
    })

    it('says it in the singular', async () => {
      const wrapper = await render(0, [], 1)

      expect(wrapper.find('[data-test="attention-ai"]').text()).toContain(
        'The AI has 1 suggestion for how your transactions are sorted.',
      )
    })

    it('says nothing when there are none, which is always so without AI', async () => {
      const wrapper = await render(2, [], 0)

      expect(wrapper.find('[data-test="attention-ai"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="attention-uncategorized"]').exists()).toBe(true)
    })

    it('sits with the other things that need a look', async () => {
      const wrapper = await render(2, [fidelity], 4)

      expect(wrapper.findAll('[data-test="attention"] .v-alert')).toHaveLength(3)
    })
  })
})
