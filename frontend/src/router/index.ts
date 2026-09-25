import { createRouter, createWebHistory, type RouteRecordRaw, type Router } from 'vue-router'

import { navItems, type NavName } from '@/navigation'

const views: Record<NavName, NonNullable<RouteRecordRaw['component']>> = {
  accounts: () => import('@/views/AccountsView.vue'),
  budget: () => import('@/views/BudgetView.vue'),
  subscriptions: () => import('@/views/SubscriptionsView.vue'),
  transactions: () => import('@/views/TransactionsView.vue'),
  import: () => import('@/views/ImportView.vue'),
  connect: () => import('@/views/ConnectView.vue'),
  settings: () => import('@/views/SettingsView.vue'),
}

export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/accounts' },
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

export function buildRouter(history = createWebHistory()): Router {
  const router = createRouter({ history, routes })
  router.afterEach((to) => {
    document.title = [to.meta.title, 'Cashcove'].filter(Boolean).join(' · ')
  })
  return router
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
  }
}
