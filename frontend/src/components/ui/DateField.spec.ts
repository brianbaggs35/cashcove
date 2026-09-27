import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import DateField from '@/components/ui/DateField.vue'
import { page, typeDate } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'

async function render(initial: string | null, props: Record<string, unknown> = {}, locale = 'en-US') {
  const day = ref<string | null>(initial)
  const Host = defineComponent({
    render: () =>
      h(DateField, {
        label: 'Date',
        ...props,
        modelValue: day.value,
        'onUpdate:modelValue': (value: string | null) => (day.value = value),
      }),
  })
  const { wrapper } = await mountWithPlugins(Host, {
    width: 1280,
    beforeMount: () => {
      seedFinance().preferences.saved!.general.locale = locale
    },
  })
  const input = wrapper.find('input')
  return { wrapper, day, input }
}

const shown = (input: { element: Element }) => (input.element as HTMLInputElement).value

describe('DateField', () => {
  it.each([
    ['en-US', '09/20/2026'],
    ['en-GB', '20/09/2026'],
    ['de-DE', '20.09.2026'],
    ['en-CA', '2026-09-20'],
  ])('shows the day the way %s writes it', async (locale, expected) => {
    const { input } = await render('2026-09-20', {}, locale)
    expect(shown(input)).toBe(expected)
  })

  it.each<[string, Intl.DateTimeFormatPart[], string]>([
    [
      'no separator between the parts',
      [
        { type: 'day', value: '20' },
        { type: 'month', value: '09' },
        { type: 'year', value: '2026' },
      ],
      '20/09/2026',
    ],
    [
      'spaces between the parts',
      [
        { type: 'year', value: '2026' },
        { type: 'literal', value: ' ' },
        { type: 'month', value: '09' },
        { type: 'literal', value: ' ' },
        { type: 'day', value: '20' },
      ],
      '2026/09/20',
    ],
  ])('separates the parts with slashes when the format has %s', async (_, parts, expected) => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'formatToParts').mockReturnValue(parts)
    const { input } = await render('2026-09-20')
    expect(shown(input)).toBe(expected)
  })

  it('reads a typed day', async () => {
    const { day, input } = await render('2026-09-20')
    await typeDate(input, '09/18/2026')
    await flushPromises()
    expect(day.value).toBe('2026-09-18')
  })

  it('picks a day from the calendar', async () => {
    const { day, input } = await render('2026-09-20', { min: '2026-09-01', max: '2026-09-30' })
    await input.trigger('click')
    await flushPromises()
    await page().find('button[data-v-date="2026-09-15"]').trigger('click')
    await flushPromises()
    expect(day.value).toBe('2026-09-15')
  })

  it('can be cleared, unless a day is required', async () => {
    const optional = await render('2026-09-20')
    await typeDate(optional.input, '')
    await flushPromises()
    expect(optional.day.value).toBeNull()
    expect(optional.wrapper.find('.v-messages').text()).toBe('')

    const required = await render('2026-09-20', { required: true, label: 'Day it happened' })
    await typeDate(required.input, '')
    await required.input.trigger('blur')
    await flushPromises()
    expect(required.day.value).toBeNull()
    expect(required.wrapper.find('.v-messages').text()).toBe('Choose the day it happened')
  })
})
