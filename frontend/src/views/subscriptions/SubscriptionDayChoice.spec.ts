import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import SubscriptionDayChoice from '@/views/subscriptions/SubscriptionDayChoice.vue'

async function render(
  initial: string | null,
  props: Partial<InstanceType<typeof SubscriptionDayChoice>['$props']> = {},
) {
  const day = ref<string | null>(initial)
  const Host = defineComponent({
    render: () =>
      h(SubscriptionDayChoice, {
        label: 'Ends on',
        hint: 'No payment is expected on or after this day.',
        today: '2026-10-19',
        suggested: '2026-10-28',
        suggestedName: 'Next payment',
        part: 'subscription-cancel',
        ...props,
        modelValue: day.value,
        'onUpdate:modelValue': (value: string | null) => (day.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => seedFinance(),
  })
  const find = (name: string) => wrapper.find(`[data-test="subscription-cancel-${name}"]`)
  const pressed = (name: string) => find(name).attributes('aria-pressed')
  return { wrapper, day, find, pressed }
}

describe('SubscriptionDayChoice', () => {
  it('is a date field that has to be filled in, with what it means under it', async () => {
    const { find, wrapper } = await render('2026-10-28')

    const field = wrapper.findComponent({ name: 'DateField' })
    expect(field.props('label')).toBe('Ends on')
    expect(field.props('required')).toBe(true)
    // The days the API takes, so nothing it would refuse can be picked.
    expect(field.props('min')).toBe('1970-01-01')
    expect(field.props('max')).toBe('2199-12-31')
    expect(find('day').text()).toContain('No payment is expected on or after this day.')
    expect((find('day').find('input').element as HTMLInputElement).value).toBe('10/28/2026')
  })

  it('offers today and the day it suggests, the second named and dated in the household’s way', async () => {
    const { find } = await render('2026-10-28')

    expect(find('today').text()).toBe('Today')
    expect(find('suggested').text()).toBe('Next payment, Oct 28')
  })

  it('leaves out the suggestion when there is none worth offering', async () => {
    const { find } = await render('2026-10-19', { suggested: null })

    expect(find('today').exists()).toBe(true)
    expect(find('suggested').exists()).toBe(false)
  })

  it('shows which quick choice the day is, and none when it is another day', async () => {
    const suggested = await render('2026-10-28')
    expect([suggested.pressed('today'), suggested.pressed('suggested')]).toEqual(['false', 'true'])

    const today = await render('2026-10-19')
    expect([today.pressed('today'), today.pressed('suggested')]).toEqual(['true', 'false'])

    const other = await render('2026-12-25')
    expect([other.pressed('today'), other.pressed('suggested')]).toEqual(['false', 'false'])

    const empty = await render(null)
    expect([empty.pressed('today'), empty.pressed('suggested')]).toEqual(['false', 'false'])

    // With nothing suggested, an empty day is not "the suggestion" either.
    const nothing = await render(null, { suggested: null })
    expect(nothing.pressed('today')).toBe('false')
  })

  it('sets the day from either quick choice', async () => {
    const { find, day, pressed } = await render('2026-12-25')

    await find('today').trigger('click')
    expect(day.value).toBe('2026-10-19')
    expect(pressed('today')).toBe('true')

    await find('suggested').trigger('click')
    expect(day.value).toBe('2026-10-28')
    expect([pressed('today'), pressed('suggested')]).toEqual(['false', 'true'])
  })

  it('keeps the day when the choice that is chosen is pressed again', async () => {
    const { find, day, pressed } = await render('2026-10-28')

    await find('suggested').trigger('click')
    await flushPromises()

    expect(day.value).toBe('2026-10-28')
    expect(pressed('suggested')).toBe('true')
  })

  it('takes the day from the date field too', async () => {
    const { wrapper, day, pressed } = await render('2026-10-28')

    wrapper.findComponent({ name: 'DateField' }).vm.$emit('update:modelValue', '2027-02-01')
    await flushPromises()

    expect(day.value).toBe('2027-02-01')
    expect([pressed('today'), pressed('suggested')]).toEqual(['false', 'false'])
  })

  it('shows what the API said was wrong with the day', async () => {
    const { find } = await render('2026-10-28', { error: 'Pick a later day.' })

    expect(find('day').text()).toContain('Pick a later day.')
  })
})
