import type { EventEmitter } from 'node:events'
import { format } from 'node:util'

import { resetApiHooks } from '@/api/client'
import { confirmRequest } from '@/composables/confirm'
import { notices } from '@/composables/notify'
import { verificationRequest } from '@/composables/verification'
import { unmountAll } from '@/test/cleanup'

// jsdom lacks the layout APIs Vuetify relies on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub

window.matchMedia = (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList

// Vuetify's menu positioning reads the visual viewport.
globalThis.visualViewport = Object.assign(new EventTarget(), {
  width: window.innerWidth,
  height: window.innerHeight,
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  onresize: null,
  onscroll: null,
  onscrollend: null,
})

// Vue and Vuetify warn on the console, and jsdom reports there what it can't do, such as really
// submitting a form. A test that sets any of them off fails, so a warning is fixed where it starts
// rather than scrolling past in CI's output.
const consoleOutput: string[] = []
for (const level of ['warn', 'error'] as const) {
  console[level] = (...args: unknown[]) => {
    consoleOutput.push(format(...args))
  }
}
// jsdom's reports skip that console and go straight to the terminal, so they're collected here.
const { jsdom } = globalThis as unknown as { jsdom: { virtualConsole: EventEmitter } }
jsdom.virtualConsole.removeAllListeners('jsdomError')
jsdom.virtualConsole.on('jsdomError', (error: Error) => {
  consoleOutput.push(error.message)
})

function failOnConsoleOutput() {
  const output = consoleOutput.splice(0)
  if (output.length) {
    throw new Error(
      `Tests must run without warnings or errors, but this printed:\n\n${output.join('\n\n')}`,
    )
  }
}

// Nothing reaches a real network; tests mock the API functions they rely on.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch is not mocked')))
})

afterEach(() => {
  unmountAll()
  // Module-level state the app shares between components starts fresh for each test.
  resetApiHooks()
  notices.value = []
  confirmRequest.value = null
  verificationRequest.value?.resolve(false)
  sessionStorage.clear()
  localStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  failOnConsoleOutput()
})

// Catches anything printed after a file's last test, such as work left running when it ended.
afterAll(failOnConsoleOutput)
