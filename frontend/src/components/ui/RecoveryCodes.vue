<script setup lang="ts">
import { Check, Copy, Download } from '@lucide/vue'

import { useClipboard } from '@/composables/useClipboard'
import { formatDateTime } from '@/utils/format'

/** Freshly made recovery codes, shown once, with ways to keep them. */
const props = defineProps<{ codes: string[]; email: string }>()
const { copied, copy } = useClipboard()

function asText(): string {
  return [
    'Cashcove recovery codes',
    `Account: ${props.email}`,
    `Created: ${formatDateTime(new Date())}`,
    '',
    ...props.codes,
    '',
    'Each code signs you in once if you lose your authenticator app.',
    'Keep them somewhere safe, like a password manager.',
  ].join('\n')
}

function download() {
  const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'cashcove-recovery-codes.txt'
  link.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="recovery-codes" data-test="recovery-codes">
    <ol class="recovery-codes__grid pa-4">
      <li v-for="code in codes" :key="code" class="recovery-codes__code">{{ code }}</li>
    </ol>
    <div class="d-flex flex-wrap ga-2 mt-3">
      <v-btn
        :prepend-icon="copied ? Check : Copy"
        :color="copied ? 'success' : undefined"
        variant="tonal"
        data-test="recovery-codes-copy"
        @click="copy(asText())"
      >
        {{ copied ? 'Copied' : 'Copy all' }}
      </v-btn>
      <v-btn
        :prepend-icon="Download"
        variant="tonal"
        data-test="recovery-codes-download"
        @click="download"
      >
        Download
      </v-btn>
    </div>
  </div>
</template>

<style scoped>
.recovery-codes__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 10px 24px;
  margin: 0;
  list-style: none;
  border-radius: 16px;
  background: rgba(var(--v-theme-surface-variant), 0.6);
  border: 1px dashed rgba(var(--v-border-color), 0.3);
}

.recovery-codes__code {
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
  font-size: 0.9375rem;
  letter-spacing: 0.04em;
  user-select: all;
}
</style>
