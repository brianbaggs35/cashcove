import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { errorMessage } from '@/api/client'
import { fetchSubscriptions, type Subscription } from '@/api/subscriptions'

/** The household's subscriptions, for naming the one a transaction or an automation links to. */
export const useSubscriptionsStore = defineStore('subscriptions', () => {
  const subscriptions = ref<Subscription[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  const byId = computed(() => new Map(subscriptions.value.map((item) => [item.id, item])))
  /** The ones Cashcove is still matching payments to. */
  const active = computed(() => subscriptions.value.filter((item) => item.active))

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        subscriptions.value = await fetchSubscriptions()
        loaded.value = true
      } catch (loadError) {
        error.value = errorMessage(loadError)
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }

  /** Loads the subscriptions the first time something needs them. */
  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function find(id: string | null | undefined): Subscription | undefined {
    return id ? byId.value.get(id) : undefined
  }

  return { subscriptions, loaded, loading, error, byId, active, load, ensureLoaded, find }
})
