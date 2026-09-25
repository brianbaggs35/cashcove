import type { Component } from 'vue'

import { useHealthStore } from '@/stores/health'
import { usePreferencesStore } from '@/stores/preferences'
import { healthyReport, makePreferences, makeSystemInfo } from '@/test/fixtures'
import { mountWithPlugins, type MountOptions } from '@/test/mount'

/** Mounts a settings section with preferences and system info already loaded. */
export async function mountSection(component: Component, options: MountOptions = {}) {
  const mounted = await mountWithPlugins(component, options)
  const preferences = usePreferencesStore()
  preferences.saved = makePreferences()
  preferences.draft = makePreferences()
  const health = useHealthStore()
  health.health = healthyReport
  health.system = makeSystemInfo()
  await mounted.wrapper.vm.$nextTick()
  return { ...mounted, preferences, health }
}
