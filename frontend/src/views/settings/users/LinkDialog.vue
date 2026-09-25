<script setup lang="ts">
import { Link2, type LucideIcon } from '@lucide/vue'

import AppDialog from '@/components/ui/AppDialog.vue'
import CopyField from '@/components/ui/CopyField.vue'
import { formatDateTime } from '@/utils/format'

/**
 * A one-time link for someone else, like an invitation or a password reset. Cashcove keeps only
 * a hash of it, so this is the one chance to copy it.
 */
withDefaults(
  defineProps<{
    title: string
    /** Who to send it to, and what it lets them do. */
    text: string
    link: string
    expiresAt: string
    icon?: LucideIcon
  }>(),
  { icon: () => Link2 },
)
const open = defineModel<boolean>({ required: true })
</script>

<template>
  <AppDialog v-model="open" :title="title" :icon="icon" tone="success" max-width="560">
    <p class="text-body-medium mb-4">{{ text }}</p>
    <CopyField :value="link" label="One-time link" test-id="one-time-link" />
    <p class="text-body-small text-medium-emphasis mt-3 mb-0">
      It works once and expires {{ formatDateTime(expiresAt) }}. Cashcove doesn't send email, so
      share it however you trust, like a text message. You won't be able to see this link again.
    </p>
    <template #actions>
      <v-btn color="primary" variant="flat" data-test="link-done" @click="open = false">Done</v-btn>
    </template>
  </AppDialog>
</template>
