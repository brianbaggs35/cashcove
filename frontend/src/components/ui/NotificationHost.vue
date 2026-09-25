<script setup lang="ts">
import { X } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { notices } from '@/composables/notify'

// Shows notify() messages one at a time; mounted once, in App.vue.
const current = computed(() => notices.value[0] ?? null)
const open = ref(false)

watch(current, (notice) => (open.value = notice !== null), { immediate: true })

/** Closes this message, then shows the next once the snackbar has animated out. */
function dismiss() {
  const id = current.value?.id
  open.value = false
  setTimeout(() => {
    if (notices.value[0]?.id === id) notices.value.shift()
  }, 250)
}
</script>

<template>
  <v-snackbar
    :model-value="open"
    :timeout="current?.timeout ?? 4000"
    :color="current?.tone"
    location="bottom"
    rounded="lg"
    data-test="notification"
    @update:model-value="(value) => value || dismiss()"
  >
    <div v-if="current" class="d-flex align-center ga-3">
      <v-icon :icon="current.icon" size="20" />
      <span class="text-body-medium font-weight-medium">{{ current.text }}</span>
    </div>
    <template #actions>
      <v-btn
        :icon="X"
        size="small"
        variant="text"
        aria-label="Dismiss"
        data-test="notification-dismiss"
        @click="dismiss"
      />
    </template>
  </v-snackbar>
</template>
