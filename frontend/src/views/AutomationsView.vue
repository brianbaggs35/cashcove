<script setup lang="ts">
import { Plus, Search, WandSparkles } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'

import {
  deleteAutomation,
  fetchAutomations,
  updateAutomation,
  type Automation,
  type AutomationSaved,
} from '@/api/automations'
import { errorMessage } from '@/api/client'
import TabPage from '@/components/TabPage.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAccountsStore } from '@/stores/accounts'
import { useAuthStore } from '@/stores/auth'
import { useBudgetsStore } from '@/stores/budgets'
import { useCategoriesStore } from '@/stores/categories'
import { useSubscriptionsStore } from '@/stores/subscriptions'
import { formatCount } from '@/utils/format'
import AutomationCard from '@/views/automations/AutomationCard.vue'
import AutomationDialog from '@/views/automations/AutomationDialog.vue'

const auth = useAuthStore()
const accounts = useAccountsStore()
const categories = useCategoriesStore()
const subscriptions = useSubscriptionsStore()
const budgets = useBudgetsStore()
const automations = ref<Automation[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const search = ref('')
const activeFilter = ref<'active' | 'paused'>('active')
const dialog = ref(false)
const editing = ref<Automation | null>(null)
let request = 0

async function load() {
  const current = ++request
  loading.value = true
  error.value = null
  try {
    const result = await fetchAutomations()
    if (current === request) {
      automations.value = result
      loaded.value = true
    }
  } catch (loadError) {
    if (current === request) error.value = errorMessage(loadError)
  } finally {
    if (current === request) loading.value = false
  }
}

onMounted(() => {
  void accounts.ensureLoaded()
  void categories.ensureLoaded()
  // Fresh each time, since an automation names the subscription it links to.
  void subscriptions.load()
  void budgets.load()
  void load()
})

const visibleAutomations = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return automations.value.filter(
    (automation) =>
      automation.active === (activeFilter.value === 'active') &&
      (!query ||
        automation.name.toLocaleLowerCase().includes(query) ||
        automation.payees.some((payee) => payee.toLocaleLowerCase().includes(query))),
  )
})
const noAutomations = computed(() => loaded.value && automations.value.length === 0)

function add() {
  editing.value = null
  dialog.value = true
}

function edit(automation: Automation) {
  editing.value = automation
  dialog.value = true
}

/** What a change that sorted transactions says it did. */
function sortedNote(saved: AutomationSaved): string {
  if (!saved.applied) return ''
  return ` and sorted ${formatCount(saved.applied, 'transaction')}`
}

async function remove(automation: Automation) {
  const done = await confirmAndRun(
    {
      title: `Delete ${automation.name}?`,
      text: 'Transactions it already sorted keep their categories and links. New ones are no longer sorted, and it stops counting toward budgets.',
      confirmText: 'Delete automation',
      tone: 'error',
    },
    () => deleteAutomation(automation.id),
  )
  if (!done) return
  notify(`Deleted ${automation.name}`)
  await load()
}

async function toggle(automation: Automation) {
  try {
    const saved = await updateAutomation(automation.id, { active: !automation.active })
    notify(
      automation.active
        ? `Paused ${automation.name}`
        : `Resumed ${automation.name}${sortedNote(saved)}`,
    )
    await load()
  } catch (updateError) {
    error.value = errorMessage(updateError)
  }
}
</script>

<template>
  <TabPage name="automations">
    <template v-if="auth.isAdmin && !noAutomations" #actions>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="Plus"
        data-test="automation-add"
        @click="add"
      >
        New automation
      </v-btn>
    </template>

    <ReadOnlyNotice
      v-if="!auth.isAdmin"
      text="You can see the automations. Only an admin can change them."
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4"
      title="Couldn't load or update automations"
      :text="error"
      data-test="automations-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="automations-retry" @click="load">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-if="loading && !loaded" data-test="automations-loading">
      <v-skeleton-loader type="heading, paragraph, card@3" class="rounded-xl" />
    </div>

    <v-card v-else-if="noAutomations">
      <EmptyState
        :icon="WandSparkles"
        title="Let Cashcove do the sorting"
        text="Pick a few transactions and Cashcove sorts every one like them into a category or a subscription, now and whenever more arrive."
      >
        <v-btn
          v-if="auth.isAdmin"
          color="primary"
          variant="flat"
          :prepend-icon="Plus"
          data-test="automation-add-first"
          @click="add"
        >
          Create your first automation
        </v-btn>
      </EmptyState>
    </v-card>

    <template v-else-if="loaded">
      <div class="d-flex flex-column flex-sm-row align-stretch align-sm-center ga-3 mb-5">
        <v-text-field
          v-model="search"
          :prepend-inner-icon="Search"
          label="Search automations"
          hide-details
          clearable
          class="automation-search"
          data-test="automation-search"
        />
        <v-btn-toggle
          v-model="activeFilter"
          mandatory
          divided
          variant="outlined"
          color="primary"
          aria-label="Automation status"
          data-test="automation-filter"
        >
          <v-btn value="active">Active</v-btn>
          <v-btn value="paused">Paused</v-btn>
        </v-btn-toggle>
      </div>

      <v-card v-if="!visibleAutomations.length" data-test="automations-none-match">
        <EmptyState
          :icon="Search"
          title="No matches"
          text="Try a different search or switch between active and paused automations."
          compact
        />
      </v-card>
      <v-row v-else density="compact">
        <v-col v-for="automation in visibleAutomations" :key="automation.id" cols="12" md="6">
          <AutomationCard
            :automation="automation"
            :readonly="!auth.isAdmin"
            @edit="edit"
            @delete="remove"
            @toggle="toggle"
          />
        </v-col>
      </v-row>
    </template>

    <AutomationDialog v-if="auth.isAdmin" v-model="dialog" :automation="editing" @saved="load" />
  </TabPage>
</template>

<style scoped>
.automation-search {
  max-width: 420px;
}

@media (max-width: 599px) {
  .automation-search {
    max-width: none;
  }
}
</style>
