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
})
