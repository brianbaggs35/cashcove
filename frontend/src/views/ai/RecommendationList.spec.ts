import { makeRecommendation } from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import RecommendationList from '@/views/ai/RecommendationList.vue'

const coffee = makeRecommendation()
const groceries = makeRecommendation({
  id: 'recommendation-target',
  payee: 'Target',
  amount: '18.20',
  current_category_id: 'category-groceries',
  suggested_category_id: 'category-transfers',
  confidence: 'low',
  reason: 'Looks like a refund.',
})
const decided = makeRecommendation({ id: 'recommendation-done', payee: 'Venmo', status: 'applied' })
const turnedDown = makeRecommendation({
  id: 'recommendation-no',
  payee: 'Zelle',
  status: 'dismissed',
})

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountWithPlugins(RecommendationList, {
    props: { items: [coffee, groceries, decided, turnedDown], ...props },
    beforeMount: () => seedFinance(),
  })
  return mounted.wrapper
}

describe('RecommendationList', () => {
  it('shows each suggestion: the transaction, what it has now, what the AI would give it and why', async () => {
    const wrapper = await render()
    const [first, second] = wrapper.findAll('[data-test="recommendation"]')

    expect(first!.find('[data-test="reco-payee"]').text()).toBe('Blue Bottle')
    expect(first!.text()).toContain('-$4.50')
    expect(first!.text()).toContain('Sep 18, 2026')
    const chips = first!.findAll('[data-test="category-chip"]').map((chip) => chip.text())
    expect(chips).toEqual(['Uncategorized', '☕Coffee'])
    expect(first!.find('[data-test="reco-confidence"]').text()).toBe('High confidence')
    expect(first!.find('[data-test="reco-reason"]').text()).toBe('A coffee shop.')
    expect(first!.text()).toContain('Now filed under')
    expect(first!.text()).toContain('The AI suggests')
    expect(second!.find('[data-test="reco-confidence"]').text()).toBe('Low confidence')
    expect(second!.text()).toContain('+$18.20')
  })

  it('lets an admin apply or dismiss one, naming what it applies to', async () => {
    const wrapper = await render()
    const first = wrapper.findAll('[data-test="recommendation"]')[0]!

    const apply = first.find('[data-test="reco-apply"]')
    expect(apply.attributes('aria-label')).toBe('Apply the suggestion for Blue Bottle')
    await apply.trigger('click')
    await first.find('[data-test="reco-dismiss"]').trigger('click')

    expect(wrapper.emitted('apply')).toEqual([[['recommendation-coffee']]])
    expect(wrapper.emitted('dismiss')).toEqual([[['recommendation-coffee']]])
  })

  it('lets an admin tick several', async () => {
    const wrapper = await render()
    const boxes = wrapper.findAll('[data-test="recommendation-select"] input')

    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.attributes('aria-label')).toBe('Select Blue Bottle')
    await boxes[0]!.setValue(true)
    await boxes[1]!.setValue(true)

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
      ['recommendation-coffee', 'recommendation-target'],
    ])
  })

  it('says what became of the ones already decided, and offers nothing for them', async () => {
    const wrapper = await render()
    const [, , applied, dismissed] = wrapper.findAll('[data-test="recommendation"]')

    expect(applied!.find('[data-test="reco-status"]').text()).toBe('Applied')
    expect(dismissed!.find('[data-test="reco-status"]').text()).toBe('Dismissed')
    for (const item of [applied!, dismissed!]) {
      expect(item.find('[data-test="reco-apply"]').exists()).toBe(false)
      expect(item.find('[data-test="recommendation-select"]').exists()).toBe(false)
      expect(item.classes()).toContain('reco--decided')
    }
  })

  it('can’t be used while a decision is being made', async () => {
    const wrapper = await render({ busy: true })

    expect(wrapper.find('[data-test="reco-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="reco-dismiss"]').attributes('disabled')).toBeDefined()
  })
})
