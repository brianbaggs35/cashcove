import type { BrowserContext } from '@playwright/test'

/**
 * Makes time in every page the test's browser opens come from the monotonic clock, as the unit
 * tests' setup does. Vue ignores an event dated no later than the moment its handler was
 * attached, so a wall clock that steps back (WSL2's does, by seconds, about every half minute)
 * makes it skip a click's later handlers: a menu item opened its dialog and left the menu open
 * behind it, and a spec that checked everything had closed failed at random.
 */
export async function useMonotonicClock(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const origin = Date.now() - performance.now()
    Date.now = () => Math.floor(origin + performance.now())
  })
}
