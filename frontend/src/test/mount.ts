import { mount, type ComponentMountingOptions } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, type Component } from 'vue'
import { createMemoryHistory } from 'vue-router'
import { VApp } from 'vuetify/components'

import * as authApi from '@/api/auth'
import { ApiError } from '@/api/client'
import { buildVuetify } from '@/plugins/vuetify'
import { buildRouter } from '@/router'
import { useAuthStore } from '@/stores/auth'
import { track } from '@/test/cleanup'
import { makeSessionState } from '@/test/fixtures'

export interface MountOptions {
  route?: string
  props?: Record<string, unknown>
  slots?: ComponentMountingOptions<Component>['slots']
  /** Wrap in <v-app>, which layout components such as drawers and app bars require. */
  withApp?: boolean
  /** Viewport width used for Vuetify's display breakpoints (jsdom defaults to 1024, i.e. mobile). */
  width?: number
  /** Runs after Pinia is active and before mounting, e.g. to seed stores. */
  beforeMount?: () => void
  /**
   * What the API says about the session: a signed-in admin unless a test says otherwise, or
   * `unreachable` when the API can't be reached at all.
   */
  session?: authApi.SessionState | 'unreachable'
}

/** Has the API report `session`, and puts it in the auth store as if it had loaded. */
export function useSession(session: MountOptions['session'] = makeSessionState()) {
  const fetchSession = vi.spyOn(authApi, 'fetchSession')
  if (session === 'unreachable') {
    fetchSession.mockRejectedValue(
      new ApiError(0, "Can't reach Cashcove. Check your connection and try again.", {
        code: 'offline',
      }),
    )
    return fetchSession
  }
  fetchSession.mockResolvedValue(session)
  useAuthStore().apply(session)
  return fetchSession
}

export async function mountWithPlugins(component: Component, options: MountOptions = {}) {
  if (options.width) window.innerWidth = options.width
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = buildRouter(createMemoryHistory())
  const vuetify = buildVuetify()
  useSession(options.session)
  options.beforeMount?.()

  if (options.route) {
    await router.push(options.route)
    await router.isReady()
  }

  const root = options.withApp
    ? defineComponent({
        render: () => h(VApp, () => h(component, options.props, options.slots as never)),
      })
    : component

  const wrapper = mount(root, {
    props: options.withApp ? undefined : options.props,
    slots: options.withApp ? undefined : options.slots,
    global: { plugins: [pinia, router, vuetify] },
    attachTo: document.body,
  })
  track(wrapper)
  // Installing the router starts a first navigation when no route was given; it loads the
  // session, so tests wait for it rather than have it overwrite what they set up next.
  await router.isReady()
  return { wrapper, router, pinia, vuetify }
}

export function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve))
}
