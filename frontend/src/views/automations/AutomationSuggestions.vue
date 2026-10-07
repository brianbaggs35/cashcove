<script setup lang="ts">
import { RotateCw, Sparkles, WandSparkles } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import {
  suggestAutomationsWithAi,
  type AutomationSuggestion,
  type AutomationSuggestions,
} from '@/api/ai'
import type { AutomationSaved } from '@/api/automations'
import { errorMessage } from '@/api/client'
import AppDialog from '@/components/ui/AppDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import { useAiStore } from '@/stores/ai'
import { formatCount } from '@/utils/format'
import AiProgress from '@/views/ai/AiProgress.vue'
import AutomationDialog from '@/views/automations/AutomationDialog.vue'
import AutomationSuggestionCard from '@/views/automations/AutomationSuggestionCard.vue'

/**
 * Automations the AI suggests from the categories someone chose by hand, again and again, for the
 * same payee. It looks when this opens, and says so while it does. Each suggestion is tried on
 * the household's transactions first, and making one opens the form for a new automation with it
 * filled in, so nothing is created until someone saves it.
 */
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ created: [automation: AutomationSaved] }>()

const ai = useAiStore()
const status = ref<'working' | 'done' | 'failed'>('working')
const result = ref<AutomationSuggestions | null>(null)
const error = ref('')
/** The suggestions put aside, and the ones made into automations, by which they are. */
const skipped = ref(new Set<string>())
const made = ref(new Set<string>())
const drafting = ref<AutomationSuggestion | null>(null)
const creating = ref(false)
let latest = 0

// What came back, which is only looked at once it has.
const answer = computed(() => result.value as AutomationSuggestions)
const suggestions = computed(() =>
  answer.value.suggestions.filter((item) => !skipped.value.has(item.ref)),
)
const considered = computed(() => answer.value.considered)
const found = computed(() => answer.value.suggestions.length)

async function look() {
  const request = ++latest
  status.value = 'working'
  error.value = ''
  skipped.value = new Set()
  made.value = new Set()
  try {
    const suggested = await suggestAutomationsWithAi()
    if (request !== latest) return
    result.value = suggested
    status.value = 'done'
  } catch (lookError) {
    if (request !== latest) return
    error.value = errorMessage(lookError)
    status.value = 'failed'
  }
}

// It looks each time it opens, since what has been chosen, and what is sorted, changes.
watch(open, (value) => {
  if (value) void look()
  // Whatever is still being waited for isn't wanted now.
  else latest += 1
})

function create(suggestion: AutomationSuggestion) {
  drafting.value = suggestion
  creating.value = true
}

function created(automation: AutomationSaved) {
  if (drafting.value) made.value.add(drafting.value.ref)
  emit('created', automation)
}

function skip(suggestion: AutomationSuggestion) {
  skipped.value = new Set(skipped.value).add(suggestion.ref)
}
</script>

<template>
  <AppDialog
    v-model="open"
    title="Suggested automations"
    subtitle="From the categories you chose by hand, again and again. Nothing is created until you save it."
    :icon="Sparkles"
    max-width="720"
    fullscreen-on-mobile
    data-test="automation-suggestions"
  >
    <div v-if="status === 'working'" class="py-4" data-test="suggestions-working">
      <AiProgress
        working="Looking at the categories you chose by hand…"
        :privacy="`Only each payee as it is written, with account details taken out, your category names and how often you chose them go to ${ai.modelName ?? 'the AI'}.`"
      />
    </div>

    <v-alert
      v-else-if="status === 'failed'"
      type="error"
      variant="tonal"
      density="compact"
      :text="error"
      data-test="suggestions-error"
    />

    <EmptyState
      v-else-if="!considered"
      :icon="WandSparkles"
      title="Nothing to suggest yet"
      text="An automation is suggested when you’ve put the same payee in the same category by hand three times, and none sorts it already."
      compact
      data-test="suggestions-none"
    />

    <EmptyState
      v-else-if="!found"
      :icon="WandSparkles"
      title="No rule fits"
      :text="`The AI looked at ${formatCount(considered, 'payee')} you chose a category for, and none had text that all of them share.`"
      compact
      data-test="suggestions-no-rule"
    />

    <template v-else>
      <p class="text-body-medium mb-4" data-test="suggestions-summary">
        {{ formatCount(found, 'suggestion') }} from {{ formatCount(considered, 'payee') }} you
        sorted by hand.
      </p>
      <div class="d-flex flex-column ga-3">
        <AutomationSuggestionCard
          v-for="item in suggestions"
          :key="item.ref"
          :suggestion="item"
          :created="made.has(item.ref)"
          @create="create(item)"
          @skip="skip(item)"
        />
      </div>
      <p v-if="!suggestions.length" class="text-body-medium mb-0" data-test="suggestions-done">
        That’s all of them.
      </p>
    </template>

    <template #actions>
      <v-spacer />
      <v-btn
        v-if="status !== 'working'"
        variant="text"
        :prepend-icon="RotateCw"
        data-test="suggestions-again"
        @click="look"
      >
        Look again
      </v-btn>
      <v-btn variant="text" data-test="suggestions-close" @click="open = false">
        {{ status === 'working' ? 'Cancel' : 'Close' }}
      </v-btn>
    </template>

    <AutomationDialog v-model="creating" :automation="null" :draft="drafting" @saved="created" />
  </AppDialog>
</template>
