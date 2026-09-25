import {
  createRouter,
  createWebHistory,
  type RouteLocationNormalized,
  type RouteLocationRaw,
  type RouteRecordRaw,
  type Router,
} from 'vue-router'

import { onboardingStep } from '@/auth/onboarding'
import { navItems, type NavName } from '@/navigation'
import { useAuthStore } from '@/stores/auth'

const views: Record<NavName, NonNullable<RouteRecordRaw['component']>> = {
  accounts: () => import('@/views/AccountsView.vue'),
  budget: () => import('@/views/BudgetView.vue'),
  subscriptions: () => import('@/views/SubscriptionsView.vue'),
  transactions: () => import('@/views/TransactionsView.vue'),
  import: () => import('@/views/ImportView.vue'),
  connect: () => import('@/views/ConnectView.vue'),
  settings: () => import('@/views/SettingsView.vue'),
}

export const HOME = '/accounts'

export const routes: RouteRecordRaw[] = [
  {
    path: '/welcome',
    name: 'welcome',
    component: () => import('@/views/auth/WelcomeView.vue'),
    meta: { title: 'Welcome', access: 'setup', bare: true },
  },
  {
    path: '/sign-in',
    name: 'sign-in',
    component: () => import('@/views/auth/SignInView.vue'),
    meta: { title: 'Sign in', access: 'guest', bare: true },
  },
  {
    path: '/invite',
    name: 'invite',
    component: () => import('@/views/auth/InviteView.vue'),
    meta: { title: 'Join your household', access: 'public', bare: true },
  },
  {
    path: '/reset-password',
    name: 'reset-password',
    component: () => import('@/views/auth/ResetPasswordView.vue'),
    meta: { title: 'Choose a new password', access: 'public', bare: true },
  },
  { path: '/', redirect: HOME },
  ...navItems.map((item): RouteRecordRaw => ({
    // Settings sections are deep-linkable, e.g. /settings/alerts.
    path: item.name === 'settings' ? `${item.path}/:section?` : item.path,
    name: item.name,
    component: views[item.name],
    meta: { title: item.title },
  })),
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: 'Page not found' },
  },
]

/** Where to go after signing in: only paths within Cashcove, never another site. */
export function safeRedirect(value: unknown): string {
  return typeof value === 'string' && /^\/(?![/\\])/.test(value) ? value : HOME
}

/** Sends people to the page they're allowed to see: setup, sign-in or the app. */
export function checkAccess(to: RouteLocationNormalized): true | RouteLocationRaw {
  const auth = useAuthStore()
  const access = to.meta.access ?? 'member'
  if (auth.setupRequired) return to.name === 'welcome' ? true : { name: 'welcome' }
  if (access === 'setup') {
    if (auth.signedIn) return onboardingStep() ? true : HOME
    return { name: 'sign-in' }
  }
  if (access === 'public') return true
  if (access === 'guest') return auth.signedIn ? safeRedirect(to.query.redirect) : true
  if (auth.signedIn) return true
  return { name: 'sign-in', query: to.fullPath === HOME ? {} : { redirect: to.fullPath } }
}

export function buildRouter(history = createWebHistory()): Router {
  const router = createRouter({ history, routes })
  router.beforeEach(async (to) => {
    try {
      await useAuthStore().ensureLoaded()
    } catch {
      // App.vue shows that Cashcove can't be reached, with a way to try again.
      return true
    }
    return checkAccess(to)
  })
  router.afterEach((to) => {
    document.title = [to.meta.title, 'Cashcove'].filter(Boolean).join(' · ')
  })
  return router
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    /**
     * Who may open the page: `member` (the default) needs someone signed in, `guest` is for
     * the signed-out (sign-in), `setup` is the first-run wizard and `public` is for anyone.
     */
    access?: 'member' | 'guest' | 'setup' | 'public'
    /** Drawn without the app's navigation, e.g. the sign-in page. */
    bare?: boolean
  }
}
