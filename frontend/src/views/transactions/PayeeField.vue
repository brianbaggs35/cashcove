<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'

import { fetchPayees, type PayeeSuggestion } from '@/api/transactions'

/**
 * Who the money went to or came from, suggesting payees used before as you type. Picking one
 * passes on the category it had last, so the form can fill that in too.
 */
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ picked: [suggestion: PayeeSuggestion] }>()

const suggestions = ref<PayeeSuggestion[]>([])
const names = computed(() => suggestions.value.map((suggestion) => suggestion.payee))
let timer: ReturnType<typeof setTimeout> | undefined
let latest = 0

async function suggest(text: string) {
  const request = ++latest
  try {
    const found = await fetchPayees(text)
    if (request === latest) suggestions.value = found
  } catch {
    // Suggestions only save typing, so the field works without them.
  }
}

function searched(text: string | null) {
  clearTimeout(timer)
  timer = setTimeout(() => void suggest(text ?? ''), 200)
}

onScopeDispose(() => {
  clearTimeout(timer)
})

function changed(value: string | null) {
  model.value = value ?? ''
  const match = suggestions.value.find((suggestion) => suggestion.payee === value)
  if (match) emit('picked', match)
}

const rules = [
  (value: string) => !!value.trim() || 'Enter who it was paid to or received from',
  (value: string) => value.trim().length <= 160 || 'Keep it under 160 characters',
]
</script>

<template>
  <v-combobox
    :model-value="model"
    :items="names"
    :rules="rules"
    label="Payee"
    autocomplete="off"
    hide-no-data
    :menu-props="{ maxHeight: 280 }"
    @update:model-value="changed"
    @update:search="searched"
    @focus="suggest(model)"
  />
</template>
