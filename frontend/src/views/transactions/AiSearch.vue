<script setup lang="ts">
import { Search, Sparkles, X } from '@lucide/vue'
import { nextTick, ref, useTemplateRef, watch } from 'vue'

import { searchWithAi, type SearchResult } from '@/api/ai'
import { errorMessage } from '@/api/client'
import { useAiStore } from '@/stores/ai'
import { todayIso } from '@/utils/dates'
import AiProgress from '@/views/ai/AiProgress.vue'
import { isUsable } from '@/views/transactions/searchFilters'

/**
 * Finding transactions by describing them: "groceries over $50 last month". The AI turns the words
 * into the filters the tab already has, which are shown below as chips to look at and change, so
 * what it got wrong is one tap to take off. It finds no transaction itself.
 */
const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ found: [result: SearchResult] }>()

const ai = useAiStore()
const question = ref('')
const working = ref(false)
const error = ref<string | null>(null)
/** What the last search came to: what was asked, what couldn't be used, and if anything could. */
const outcome = ref<{ asked: string; ignored: string[]; usable: boolean } | null>(null)
const field = useTemplateRef<{ focus: () => void }>('field')
let latest = 0

// Opening it is for typing in it.
watch(open, async (now) => {
  if (!now) return
  await nextTick()
  ;(field.value as { focus: () => void }).focus()
})

async function find() {
  const asked = question.value.trim()
  if (!asked || working.value) return
  const request = ++latest
  working.value = true
  error.value = null
  outcome.value = null
  try {
    const result = await searchWithAi(asked, todayIso())
    if (request !== latest) return
    const usable = isUsable(result.filters)
    outcome.value = { asked, ignored: result.ignored, usable }
    if (usable) emit('found', result)
  } catch (searchError) {
    if (request === latest) error.value = errorMessage(searchError)
  } finally {
    if (request === latest) working.value = false
  }
}

/** Stops waiting for the answer, which is ignored when it comes. */
function stop() {
  latest += 1
  working.value = false
}
</script>

<template>
  <v-expand-transition>
    <div v-if="open" class="mb-4" data-test="ai-search">
      <v-sheet border rounded="lg" class="ai-search pa-4">
        <div class="d-flex align-center ga-2 mb-3">
          <v-icon :icon="Sparkles" size="20" color="primary" aria-hidden="true" />
          <h2 class="text-title-small font-weight-bold flex-grow-1 ma-0">Find with AI</h2>
          <v-btn
            :icon="X"
            variant="text"
            size="small"
            density="comfortable"
            aria-label="Close"
            data-test="ai-search-close"
            @click="open = false"
          />
        </div>

        <form
          class="d-flex flex-column flex-sm-row align-sm-start ga-3"
          aria-label="Find transactions with AI"
          @submit.prevent="find"
        >
          <v-text-field
            ref="field"
            v-model="question"
            label="Describe what to find"
            placeholder="Groceries over $50 last month"
            persistent-placeholder
            hint="It becomes filters you can change below. Only what you type and your category names go to the AI."
            persistent-hint
            maxlength="300"
            density="comfortable"
            :prepend-inner-icon="Search"
            :readonly="working"
            data-test="ai-search-input"
          />
          <v-btn
            type="submit"
            color="primary"
            variant="flat"
            height="48"
            :prepend-icon="Sparkles"
            :loading="working"
            :disabled="!question.trim()"
            data-test="ai-search-find"
          >
            Find
            <template #loader>
              <v-progress-circular indeterminate size="20" width="2" aria-hidden="true" />
            </template>
          </v-btn>
        </form>

        <div v-if="working" class="mt-4" data-test="ai-search-working">
          <AiProgress
            working="Working out the filters…"
            :privacy="`Only what you typed, with account details taken out, and your category names go to ${ai.modelName ?? 'the AI'}. The accounts you name are found here.`"
          />
          <v-btn
            variant="text"
            size="small"
            :prepend-icon="X"
            class="mt-2 ms-n2"
            data-test="ai-search-stop"
            @click="stop"
          >
            Stop
          </v-btn>
        </div>

        <v-alert
          v-if="error"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-4"
          :text="error"
          data-test="ai-search-error"
        />

        <v-alert
          v-if="outcome"
          :type="outcome.usable ? 'info' : 'warning'"
          variant="tonal"
          density="compact"
          role="status"
          class="mt-4"
          :data-test="outcome.usable ? 'ai-search-result' : 'ai-search-nothing'"
        >
          <template v-if="outcome.usable">
            Showing what matches “{{ outcome.asked }}”. Change the filters below, or search again.
          </template>
          <template v-else>
            There was no filter in that. Try naming a category, an amount or a time, like “groceries
            over $50 last month”.
          </template>
          <div v-if="outcome.ignored.length" class="mt-1" data-test="ai-search-ignored">
            Couldn’t use: {{ outcome.ignored.join(', ') }}.
          </div>
        </v-alert>
      </v-sheet>
    </div>
  </v-expand-transition>
</template>
