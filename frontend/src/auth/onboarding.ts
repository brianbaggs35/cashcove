// The first-run wizard keeps going after the admin account exists (securing it, household
// details), so it remembers the step for this browser tab in case the page is reloaded.

const KEY = 'cashcove.onboarding'

export type OnboardingStep = 'secure' | 'household' | 'done'

const STEPS: readonly string[] = ['secure', 'household', 'done'] satisfies OnboardingStep[]

export function onboardingStep(): OnboardingStep | null {
  try {
    const step = sessionStorage.getItem(KEY)
    return step !== null && STEPS.includes(step) ? (step as OnboardingStep) : null
  } catch {
    return null
  }
}

export function saveOnboardingStep(step: OnboardingStep | null): void {
  try {
    if (step) sessionStorage.setItem(KEY, step)
    else sessionStorage.removeItem(KEY)
  } catch {
    // Storage can be unavailable (private mode); a reload then just lands in the app.
  }
}
