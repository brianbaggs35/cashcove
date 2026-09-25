import { defineStore } from 'pinia'
import { ref } from 'vue'

import { fetchHealth, type Health } from '@/api/health'
import { fetchSystemInfo, type SystemInfo } from '@/api/system'

export const useHealthStore = defineStore('health', () => {
  const health = ref<Health | null>(null)
  const system = ref<SystemInfo | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      ;[health.value, system.value] = await Promise.all([fetchHealth(), fetchSystemInfo()])
    } catch (caught) {
      health.value = null
      system.value = null
      error.value = caught instanceof Error ? caught.message : String(caught)
    } finally {
      loading.value = false
    }
  }

  return { health, system, loading, error, refresh }
})
