import { flushPromises } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'

import * as api from '@/api/budget'
import type { Budget } from '@/api/budget'
import { ApiError } from '@/api/client'
import { notices } from '@/composables/notify'
import { makeBudget } from '@/test/budgets'
import { page, typeDate } from '@/test/dom'
import { seedFinance } from '@/test/finance'
import { mountWithPlugins } from '@/test/mount'
import BudgetDialog from '@/views/budget/BudgetDialog.vue'

async function render(budget: Budget | null = null) {
  const open = ref(false)
  const saved = vi.fn()
  const Host = defineComponent({
    render: () =>
      h(BudgetDialog, {
        budget,
        modelValue: open.value,
        'onUpdate:modelValue': (value: boolean) => (open.value = value),
        onSaved: saved,
      }),
  })
  const mounted = await mountWithPlugins(Host, { width: 1280, beforeMount: () => seedFinance() })
  open.value = true
  await flushPromises()
  const overlay = () => page().find('.v-overlay--active .app-dialog')
  const field = (name: string) => overlay().find(`[data-test="budget-${name}"]`)
  const input = (name: string) => field(name).find('input')
  const period = (value: string) => overlay().find(`[data-test="period-${value}"]`)
  const valid = async () => {
    mounted.wrapper.findComponent({ name: 'VForm' }).vm.$emit('update:modelValue', true)
    await flushPromises()
  }
  return { ...mounted, open, saved, overlay, field, input, period, valid }
}

const day = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)

describe('BudgetDialog', () => {
  it('starts empty, as a monthly budget, with nothing to save until it is valid', async () => {
    const { overlay, field, input } = await render()

    expect(overlay().find('h2').text()).toBe('New budget')
    expect((input('name').element as HTMLInputElement).value).toBe('')
    expect(field('period-hint').text()).toBe('Starts over on the 1st of each month.')
    expect(field('amount').text()).toContain('Amount per month')
    expect(field('save').attributes('disabled')).toBeDefined()
    expect(field('save').text()).toBe('Add budget')
    expect(field('period-change').exists()).toBe(false)
  })

  it('adds a budget', async () => {
    const created = makeBudget({ name: 'Pay period' })
    const create = vi.spyOn(api, 'createBudget').mockResolvedValue(created)
    const { field, input, period, saved, open, valid } = await render()

    await input('name').setValue('  Pay period ')
    await period('biweekly').trigger('click')
    await input('amount').setValue('1500')
    await valid()
    await field('save').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith({
      name: 'Pay period',
      period: 'biweekly',
      amount: '1500.00',
      starts_on: null,
      today: day,
    })
    expect(saved).toHaveBeenCalledWith(created)
    expect(open.value).toBe(false)
    expect(notices.value.at(-1)?.text).toBe('Added Pay period')
  })

  it('says what each choice of how often means, and names the amount for it', async () => {
    const { field, period } = await render()

    for (const [name, hint, label] of [
      ['weekly', 'Starts over every week, on your first day of the week.', 'Amount per week'],
      [
        'biweekly',
        'Starts over every two weeks, which suits being paid every other week.',
        'Amount every two weeks',
      ],
      ['yearly', 'Starts over each year, when your budget year begins.', 'Amount per year'],
    ] as const) {
      await period(name).trigger('click')
      expect(field('period-hint').text()).toBe(hint)
      expect(field('amount').text()).toContain(label)
    }
  })

  it('can start periods on a day of its own', async () => {
    const create = vi.spyOn(api, 'createBudget').mockResolvedValue(makeBudget())
    const { field, input, valid } = await render()
    await input('name').setValue('Mid-month')
    await input('amount').setValue('900')
    await typeDate(field('starts-on').find('input'), '09/15/2026')
    await valid()

    await field('save').trigger('click')
    await flushPromises()

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ starts_on: '2026-09-15' }))
  })

  it('needs a name', async () => {
    const { field, input, valid } = await render()
    await input('name').setValue('   ')
    await valid()
    await flushPromises()

    expect(field('name').text()).toContain('Give this budget a name')
    await input('name').setValue('x'.repeat(121))
    await flushPromises()
    expect(field('name').text()).toContain('Keep it under 120 characters')
  })

  it('shows what the API turned down, until the form changes', async () => {
    vi.spyOn(api, 'createBudget').mockRejectedValue(
      new ApiError(422, 'Check the highlighted fields and try again.', {
        code: 'invalid',
        fields: { name: 'That name is too long.', amount: 'Enter more than zero.' },
      }),
    )
    const { field, input, valid } = await render()
    await input('name').setValue('Home')
    await input('amount').setValue('5')
    await valid()

    await field('save').trigger('click')
    await flushPromises()

    expect(field('error').text()).toBe('Check the highlighted fields and try again.')
    expect(field('name').text()).toContain('That name is too long.')
    expect(field('amount').text()).toContain('Enter more than zero.')
    await input('name').setValue('Home 2')
    expect(field('error').exists()).toBe(false)
  })

  it('submits from the keyboard only when it is valid', async () => {
    const create = vi.spyOn(api, 'createBudget').mockResolvedValue(makeBudget())
    const { overlay, input, valid } = await render()

    await overlay().find('form').trigger('submit')
    expect(create).not.toHaveBeenCalled()

    await input('name').setValue('Home')
    await input('amount').setValue('5')
    await valid()
    await overlay().find('form').trigger('submit')
    await flushPromises()
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('changes a budget, sending only what changed', async () => {
    const budget = makeBudget()
    const update = vi
      .spyOn(api, 'updateBudget')
      .mockResolvedValue(makeBudget({ name: 'Home', amount: '2500.00' }))
    const { overlay, field, input, saved, valid } = await render(budget)
    expect(overlay().find('h2').text()).toBe('Edit budget')
    expect((input('name').element as HTMLInputElement).value).toBe('Household')
    expect(field('save').text()).toBe('Save changes')

    await input('name').setValue('Home')
    await input('amount').setValue('2500')
    await valid()
    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('budget-monthly', {
      today: day,
      name: 'Home',
      amount: '2500.00',
    })
    expect(saved).toHaveBeenCalled()
    expect(notices.value.at(-1)?.text).toBe('Saved Home')
  })

  it('warns that changing how often it repeats starts the amount over, and sends it', async () => {
    const update = vi.spyOn(api, 'updateBudget').mockResolvedValue(makeBudget({ period: 'yearly' }))
    const { field, input, period, valid } = await render(makeBudget())

    await period('yearly').trigger('click')
    expect(field('period-change').exists()).toBe(true)
    await period('monthly').trigger('click')
    expect(field('period-change').exists()).toBe(false)
    await period('yearly').trigger('click')
    await input('amount').setValue('24000')
    await typeDate(field('starts-on').find('input'), '04/01/2026')
    await valid()
    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('budget-monthly', {
      today: day,
      period: 'yearly',
      amount: '24000.00',
      starts_on: '2026-04-01',
    })
  })

  it('does not send an amount that was not changed', async () => {
    const update = vi.spyOn(api, 'updateBudget').mockResolvedValue(makeBudget({ name: 'Home' }))
    const { field, input, valid } = await render(makeBudget())
    await input('name').setValue('Home')
    await valid()

    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('budget-monthly', { today: day, name: 'Home' })
  })

  it('does not send a day to start on that was cleared', async () => {
    const update = vi.spyOn(api, 'updateBudget').mockResolvedValue(makeBudget())
    const { field, input, valid } = await render(makeBudget())
    await input('amount').setValue('2100')
    await typeDate(field('starts-on').find('input'), '')
    await valid()

    await field('save').trigger('click')
    await flushPromises()

    expect(update).toHaveBeenCalledWith('budget-monthly', { today: day, amount: '2100.00' })
  })

  it('closes from the dialog’s own close button', async () => {
    const { open } = await render()

    await page().find('[data-test="dialog-close"]').trigger('click')
    await flushPromises()

    expect(open.value).toBe(false)
  })

  it('starts afresh each time it is opened, and closes without saving', async () => {
    const create = vi.spyOn(api, 'createBudget')
    const { overlay, field, input, open } = await render()
    await input('name').setValue('Half done')

    await overlay()
      .findAll('button')
      .find((button) => button.text() === 'Cancel')!
      .trigger('click')
    expect(open.value).toBe(false)
    open.value = true
    await flushPromises()

    expect((input('name').element as HTMLInputElement).value).toBe('')
    expect(field('save').exists()).toBe(true)
    expect(create).not.toHaveBeenCalled()
  })
})
