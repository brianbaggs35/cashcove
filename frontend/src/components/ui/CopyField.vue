<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'

import { useClipboard } from '@/composables/useClipboard'

/** Text to hand on, such as a one-time link or a key, with a button that copies it. */
const props = withDefaults(
  defineProps<{ value: string; label?: string; monospace?: boolean; testId?: string }>(),
  { label: undefined, monospace: true, testId: 'copy-field' },
)
const { copied, copy } = useClipboard()
</script>

<template>
  <div class="copy-field" :data-test="testId">
    <div v-if="label" class="text-label-medium text-medium-emphasis mb-1">{{ label }}</div>
    <div class="copy-field__box d-flex align-center ga-2 ps-4 pe-1 py-1">
      <span
        class="copy-field__value flex-grow-1 text-body-medium"
        :class="{ 'copy-field__value--mono': monospace }"
        :data-test="`${testId}-value`"
      >
        {{ value }}
      </span>
      <v-btn
        :prepend-icon="copied ? Check : Copy"
        :color="copied ? 'success' : 'primary'"
        variant="tonal"
        size="small"
        :data-test="`${testId}-copy`"
        @click="copy(props.value)"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.copy-field__box {
  min-height: 48px;
  border-radius: 12px;
  background: rgba(var(--v-theme-surface-variant), 0.6);
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.copy-field__value {
  min-width: 0;
  overflow-wrap: anywhere;
  user-select: all;
}

.copy-field__value--mono {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 0.875rem;
}
</style>
