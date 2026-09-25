import { onboardingStep, saveOnboardingStep } from '@/auth/onboarding'

describe('onboarding step', () => {
  it('remembers the wizard step for this tab', () => {
    expect(onboardingStep()).toBeNull()
    saveOnboardingStep('household')
    expect(onboardingStep()).toBe('household')
    saveOnboardingStep(null)
    expect(onboardingStep()).toBeNull()
  })

  it('ignores a step it does not know', () => {
    sessionStorage.setItem('cashcove.onboarding', 'bogus')
    expect(onboardingStep()).toBeNull()
  })

  it('carries on without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(onboardingStep()).toBeNull()
    expect(() => {
      saveOnboardingStep('done')
    }).not.toThrow()
  })
})
