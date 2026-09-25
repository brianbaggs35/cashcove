import { flushPromises } from '@vue/test-utils'

import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import * as preferencesApi from '@/api/preferences'
import { onboardingStep, saveOnboardingStep } from '@/auth/onboarding'
import * as password from '@/auth/password'
import * as passkeys from '@/auth/passkeys'
import SecureAccountStep from '@/components/auth/SecureAccountStep.vue'
import { useAuthStore } from '@/stores/auth'
import { usePreferencesStore } from '@/stores/preferences'
import { makePreferences, makeSessionState, makeUser, signedOutState } from '@/test/fixtures'
import { mountWithPlugins } from '@/test/mount'
import WelcomeView from '@/views/auth/WelcomeView.vue'

const setupRequired = () => signedOutState({ setup_required: true })

async function render(session: authApi.SessionState = setupRequired(), width = 1280) {
  const scrollTo = vi.fn()
  window.scrollTo = scrollTo
  vi.spyOn(password, 'estimateStrength').mockResolvedValue({
    score: 4,
    warning: null,
    suggestions: [],
  })
  vi.spyOn(passkeys, 'browserHasPasskeys').mockReturnValue(false)
  const mounted = await mountWithPlugins(WelcomeView, { route: '/welcome', session, width })
  await flushPromises()
  const find = (selector: string) => mounted.wrapper.find(`[data-test="${selector}"]`)
  return { ...mounted, find, scrollTo }
}

type View = Awaited<ReturnType<typeof render>>

async function toAccountStep(view: View) {
  vi.spyOn(authApi, 'checkSetupCode').mockResolvedValue(undefined)
  await view.find('welcome-start').trigger('click')
  await view.find('setup-code').find('input').setValue(' abcd-efgh-ijkl ')
  await view.wrapper.find('form').trigger('submit')
  await flushPromises()
}

async function fillAccount(view: View, name = 'Alex Morgan', email = 'alex@example.com') {
  await view.find('account-name').find('input').setValue(name)
  await view.find('account-email').find('input').setValue(email)
  await view.find('account-password').find('input').setValue('violet harbor compass 58')
}

function railState(view: View) {
  return view
    .find('wizard-rail')
    .findAll('li')
    .map((step) =>
      step.classes('welcome__rail-step--done')
        ? 'done'
        : step.classes('welcome__rail-step--current')
          ? 'current'
          : 'next',
    )
}

describe('WelcomeView', () => {
  it('walks through the setup code and creating the admin account', async () => {
    const complete = vi.spyOn(authApi, 'completeSetup').mockResolvedValue(makeSessionState())
    const view = await render()
    expect(view.find('step-welcome').exists()).toBe(true)
    expect(railState(view)).toEqual(['current', 'next', 'next', 'next', 'next', 'next'])
    expect(view.find('wizard-progress').text()).toContain('Step 1 of 6')
    const progress = view.find('wizard-progress').find('[role="progressbar"]')
    expect(progress.attributes('aria-label')).toBe('Setup progress')
    expect(progress.attributes('aria-valuetext')).toBe('Step 1 of 6')

    await toAccountStep(view)
    expect(authApi.checkSetupCode).toHaveBeenCalledWith('abcd-efgh-ijkl')
    expect(view.find('step-account').exists()).toBe(true)
    expect(railState(view).slice(0, 3)).toEqual(['done', 'done', 'current'])
    // Nothing is saved for this tab until the account exists.
    expect(onboardingStep()).toBeNull()

    expect(view.find('account-submit').attributes('disabled')).toBeDefined()
    await fillAccount(view, ' Alex Morgan ', ' alex@example.com ')
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(complete).toHaveBeenCalledWith({
      setup_code: 'abcd-efgh-ijkl',
      name: 'Alex Morgan',
      email: 'alex@example.com',
      password: 'violet harbor compass 58',
    })
    expect(useAuthStore().signedIn).toBe(true)
    expect(view.find('step-secure').exists()).toBe(true)
    expect(onboardingStep()).toBe('secure')
    expect(view.scrollTo).toHaveBeenCalled()
  })

  it('shows a wrong setup code, and goes back', async () => {
    vi.spyOn(authApi, 'checkSetupCode').mockRejectedValue(
      new ApiError(400, "That setup code isn't right.", { code: 'invalid_setup_code' }),
    )
    const view = await render()
    await view.find('welcome-start').trigger('click')
    expect(view.find('setup-code-submit').attributes('disabled')).toBeDefined()
    await view.find('setup-code').find('input').setValue('nope')
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(view.find('setup-code').text()).toContain("That setup code isn't right.")
    await view.find('step-code').findAll('button')[0]!.trigger('click')
    expect(view.find('step-welcome').exists()).toBe(true)
  })

  it('checks the account details before sending them', async () => {
    const complete = vi.spyOn(authApi, 'completeSetup')
    const view = await render()
    await toAccountStep(view)
    await fillAccount(view, '  ', 'not-an-email')
    await flushPromises()
    expect(view.wrapper.text()).toContain('Tell Cashcove your name')
    expect(view.wrapper.text()).toContain('Enter a valid email address')
    await view.wrapper.find('form').trigger('submit')
    expect(complete).not.toHaveBeenCalled()
    await view
      .find('step-account')
      .findAll('button')
      .find((button) => button.text() === 'Back')!
      .trigger('click')
    expect(view.find('step-code').exists()).toBe(true)
  })

  it('goes back to the code step when the code stopped working', async () => {
    vi.spyOn(authApi, 'completeSetup').mockRejectedValue(
      new ApiError(400, 'That setup code has expired.', { code: 'invalid_setup_code' }),
    )
    const view = await render()
    await toAccountStep(view)
    await fillAccount(view)
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(view.find('step-code').exists()).toBe(true)
  })

  it('shows why the account could not be created', async () => {
    vi.spyOn(authApi, 'completeSetup').mockRejectedValue(
      new ApiError(400, 'This password is on a list of common passwords.', {
        code: 'weak_password',
      }),
    )
    const view = await render()
    await toAccountStep(view)
    await fillAccount(view)
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(view.find('account-error').text()).toContain('common passwords')
  })

  it('sends people to sign in when someone else finished setting up', async () => {
    vi.spyOn(authApi, 'completeSetup').mockRejectedValue(
      new ApiError(409, 'Cashcove is already set up.', { code: 'already_set_up' }),
    )
    const view = await render()
    await toAccountStep(view)
    useAuthStore().apply(signedOutState())
    await fillAccount(view)
    await view.wrapper.find('form').trigger('submit')
    await vi.waitFor(() => {
      expect(view.router.currentRoute.value.name).toBe('sign-in')
    })
  })

  it('moves on from protecting the account to the household', async () => {
    saveOnboardingStep('secure')
    vi.spyOn(preferencesApi, 'fetchPreferences').mockResolvedValue(makePreferences())
    const view = await render(makeSessionState())
    expect(view.find('step-secure').exists()).toBe(true)
    view.wrapper.findComponent(SecureAccountStep).vm.$emit('continue')
    await flushPromises()
    expect(view.find('step-household').exists()).toBe(true)
    expect(onboardingStep()).toBe('household')
  })

  it('saves the household name, currency and format', async () => {
    saveOnboardingStep('household')
    vi.spyOn(preferencesApi, 'fetchPreferences').mockResolvedValue(makePreferences())
    const saved = makePreferences()
    saved.general.household_name = 'The Coves'
    const save = vi.spyOn(preferencesApi, 'savePreferences').mockResolvedValue(saved)
    const view = await render(makeSessionState())
    const name = view.find('household-name').find('input')
    await name.setValue('   ')
    await view.wrapper.vm.$nextTick()
    expect(view.find('household-submit').attributes('disabled')).toBeDefined()
    expect(view.wrapper.text()).toContain('Give your household a name')
    await name.setValue('The Coves')
    await view.wrapper.findComponent({ name: 'VAutocomplete' }).setValue('EUR')
    await view.wrapper.findComponent({ name: 'VSelect' }).setValue('de-DE')
    expect(view.wrapper.find('[data-test="format-preview"]').text()).toContain('€')
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(save.mock.lastCall![0].general).toMatchObject({
      household_name: 'The Coves',
      currency: 'EUR',
      locale: 'de-DE',
    })
    expect(usePreferencesStore().saved?.general.household_name).toBe('The Coves')
    expect(usePreferencesStore().dirty).toBe(false)
    expect(view.find('step-done').exists()).toBe(true)
  })

  it('shows a household that could not be saved', async () => {
    saveOnboardingStep('household')
    vi.spyOn(preferencesApi, 'fetchPreferences').mockResolvedValue(makePreferences())
    vi.spyOn(preferencesApi, 'savePreferences').mockRejectedValue(new Error('Offline.'))
    const view = await render(makeSessionState())
    await view.wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(view.find('step-household').text()).toContain('Offline.')
  })

  it('can skip the household for now', async () => {
    saveOnboardingStep('household')
    vi.spyOn(preferencesApi, 'fetchPreferences').mockResolvedValue(makePreferences())
    const view = await render(makeSessionState())
    await view.find('household-skip').trigger('click')
    expect(view.find('step-done').exists()).toBe(true)
    expect(onboardingStep()).toBe('done')
  })

  it('tries loading the household again', async () => {
    saveOnboardingStep('household')
    const load = vi
      .spyOn(preferencesApi, 'fetchPreferences')
      .mockRejectedValueOnce(new Error('Offline.'))
      .mockReturnValueOnce(new Promise(() => undefined))
    const view = await render(makeSessionState())
    expect(view.find('household-error').text()).toContain('Offline.')
    await view.find('household-error').find('button').trigger('click')
    await flushPromises()
    expect(load).toHaveBeenCalledTimes(2)
    expect(view.find('household-loading').exists()).toBe(true)
  })

  it('finishes with places to go next', async () => {
    saveOnboardingStep('done')
    const view = await render(makeSessionState({ user: makeUser({ name: 'Alex Morgan' }) }))
    expect(view.find('step-done').find('h1').text()).toBe("You're all set, Alex")
    expect(railState(view)).toEqual(['done', 'done', 'done', 'done', 'done', 'current'])
    const links = view.find('step-done').findAll('a.welcome__next-item')
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/connect',
      '/import',
      '/settings/users',
    ])
    await view.find('welcome-finish').trigger('click')
    await vi.waitFor(() => {
      expect(view.router.currentRoute.value.name).toBe('accounts')
    })
    expect(onboardingStep()).toBeNull()
  })

  it('forgets the wizard when following a next step', async () => {
    saveOnboardingStep('done')
    const view = await render(makeSessionState())
    await view.find('step-done').find('a.welcome__next-item').trigger('click')
    expect(onboardingStep()).toBeNull()
  })

  it('sends someone signed out to sign in once setup is finished', async () => {
    const view = await render(signedOutState())
    await vi.waitFor(() => {
      expect(view.router.currentRoute.value.name).toBe('sign-in')
    })
  })

  it('shows the done step without a name when nobody is signed in', async () => {
    const view = await render(signedOutState(), 1280)
    // Mounted before the redirect lands: the page still reads well.
    expect(view.find('step-done').find('h1').text()).toBe("You're all set")
  })
})
