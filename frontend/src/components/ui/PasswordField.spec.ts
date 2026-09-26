import { defineComponent, h, ref } from 'vue'

import * as password from '@/auth/password'
import PasswordField from '@/components/ui/PasswordField.vue'
import { flushPromises, mountWithPlugins } from '@/test/mount'

type Props = Record<string, unknown>

async function render(props: Props = {}) {
  const value = ref('')
  const Host = defineComponent({
    render: () =>
      h(PasswordField, {
        ...props,
        modelValue: value.value,
        'onUpdate:modelValue': (next: string) => (value.value = next),
      }),
  })
  const mounted = await mountWithPlugins(Host)
  const find = (name: string) =>
    mounted.wrapper.find(
      `[data-test="${(props.testId as string | undefined) ?? 'password'}${name}"]`,
    )
  return { ...mounted, value, find }
}

function strength(
  score: password.StrengthScore,
  warning: string | null = null,
  suggestions: string[] = [],
) {
  return { score, warning, suggestions }
}

describe('PasswordField', () => {
  it('hides the password until asked to show it', async () => {
    const { wrapper, find, value } = await render()
    const input = () => wrapper.find('input')
    expect(input().attributes('type')).toBe('password')
    expect(input().attributes('autocomplete')).toBe('current-password')
    expect(wrapper.find('label').text()).toBe('Password')
    await input().setValue('secret')
    expect(value.value).toBe('secret')
    await find('-toggle').trigger('click')
    expect(input().attributes('type')).toBe('text')
    expect(find('-toggle').attributes('aria-label')).toBe('Hide password')
    await find('-toggle').trigger('click')
    expect(input().attributes('type')).toBe('password')
    expect(find('-meter').exists()).toBe(false)
  })

  it('warns when Caps Lock is on', async () => {
    const { wrapper } = await render({ label: 'Your password' })
    const input = wrapper.find('input')
    const press = (type: string, capsLock: boolean) => {
      const event = new KeyboardEvent(type, { bubbles: true })
      Object.defineProperty(event, 'getModifierState', { value: () => capsLock })
      input.element.dispatchEvent(event)
      return flushPromises()
    }
    await press('keydown', true)
    expect(wrapper.text()).toContain('Caps Lock is on')
    await press('keyup', false)
    expect(wrapper.text()).not.toContain('Caps Lock is on')
    expect(wrapper.find('label').text()).toBe('Your password')
  })

  it('shows error messages', async () => {
    const { wrapper } = await render({ errorMessages: 'That password is wrong.' })
    expect(wrapper.text()).toContain('That password is wrong.')
  })

  it('explains what makes a good password before anything is typed', async () => {
    const estimate = vi.spyOn(password, 'estimateStrength')
    const { wrapper, find } = await render({ newPassword: true })
    expect(wrapper.find('input').attributes('autocomplete')).toBe('new-password')
    expect(find('-strength').text()).toBe('Strength')
    expect(find('-tip').text()).toContain('Use at least 12 characters')
    expect(estimate).not.toHaveBeenCalled()
  })

  it('points out a password the API would reject', async () => {
    vi.spyOn(password, 'estimateStrength').mockResolvedValue(strength(4))
    const { wrapper, find } = await render({ newPassword: true, context: { name: 'Alex Morgan' } })
    await wrapper.find('input').setValue('alexmorgan12')
    await flushPromises()
    expect(find('-strength').text()).toBe('Not yet')
    expect(find('-tip').text()).toContain('your name')
    expect(wrapper.findAll('.password-field__bar--error')).toHaveLength(1)
  })

  it.each([
    [
      strength(0, 'This is a top-10 common password.'),
      'Easy to guess',
      'This is a top-10 common password.',
      'error',
      1,
    ],
    [
      strength(1, null, ['Add another word or two.']),
      'Easy to guess',
      'Add another word or two.',
      'error',
      1,
    ],
    [strength(2, 'Dates are easy to guess.'), 'Fair', 'Dates are easy to guess.', 'warning', 2],
    [
      strength(3),
      'Strong',
      'Looks good. A password manager can remember it for you.',
      'success',
      3,
    ],
    [
      strength(4),
      'Excellent',
      'Looks good. A password manager can remember it for you.',
      'success',
      4,
    ],
  ])('rates %j', async (result, label, tip, color, bars) => {
    vi.spyOn(password, 'estimateStrength').mockResolvedValue(result)
    const { wrapper, find } = await render({ newPassword: true, testId: 'new' })
    await wrapper.find('input').setValue('violet harbor compass')
    await flushPromises()
    expect(find('-strength').text()).toBe(label)
    expect(find('-strength').classes()).toContain(`text-${color}`)
    expect(find('-tip').text()).toBe(tip)
    expect(wrapper.findAll(`.password-field__bar--${color}`)).toHaveLength(bars)
  })

  it('has no tip for a weak password without advice', async () => {
    vi.spyOn(password, 'estimateStrength').mockResolvedValue(strength(1))
    const { wrapper, find } = await render({ newPassword: true })
    await wrapper.find('input').setValue('violet harbor compass')
    await flushPromises()
    expect(find('-tip').exists()).toBe(false)
  })

  it('shows only the newest estimate, however quickly someone types', async () => {
    const pending: ((result: password.Strength) => void)[] = []
    vi.spyOn(password, 'estimateStrength').mockImplementation(
      () => new Promise((resolve) => pending.push(resolve)),
    )
    const { wrapper, find } = await render({ newPassword: true })
    await wrapper.find('input').setValue('violet harbor')
    await wrapper.find('input').setValue('violet harbor compass')
    // Nothing to show until the estimate arrives.
    expect(find('-strength').text()).toBe('Strength')
    expect(find('-tip').exists()).toBe(false)
    pending[1]!(strength(4))
    await flushPromises()
    pending[0]!(strength(0))
    await flushPromises()
    expect(find('-strength').text()).toBe('Excellent')

    await wrapper.find('input').setValue('')
    await flushPromises()
    expect(find('-strength').text()).toBe('Strength')
  })
})
