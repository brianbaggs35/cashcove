import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { fetchBills } from '@/api/bills'
import { errorMessage } from '@/api/client'
import { fetchSubscriptions, type Subscription } from '@/api/subscriptions'

/**
 * The household's subscriptions and bills, for naming the one a transaction, an automation or a
 * budget links to. A payment links to either the same way, so `find` knows both.
 */
export const useSubscriptionsStore = defineStore('subscriptions', () => {
  const subscriptions = ref<Subscription[]>([])
  const bills = ref<Subscription[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  /** Every subscription and every bill. */
  const recurring = computed(() => [...subscriptions.value, ...bills.value])
  const byId = computed(() => new Map(recurring.value.map((item) => [item.id, item])))
  /** The subscriptions Cashcove is still matching payments to. */
  const active = computed(() => subscriptions.value.filter((item) => item.active))
  /** The bills Cashcove is still matching payments to. */
  const activeBills = computed(() => bills.value.filter((item) => item.active))

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        const [subscriptionList, billList] = await Promise.all([fetchSubscriptions(), fetchBills()])
        subscriptions.value = subscriptionList
        bills.value = billList
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

  /** Loads them the first time something needs them. */
  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  /** A subscription or a bill by its ID. */
  function find(id: string | null | undefined): Subscription | undefined {
    return id ? byId.value.get(id) : undefined
  }

  return {
    subscriptions,
    bills,
    recurring,
    loaded,
    loading,
    error,
    byId,
    active,
    activeBills,
    load,
    ensureLoaded,
    find,
  }
})
