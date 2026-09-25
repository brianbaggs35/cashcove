<script setup lang="ts">
import { CircleHelp, TriangleAlert } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import AppDialog from '@/components/ui/AppDialog.vue'
import { confirmRequest as request } from '@/composables/confirm'
import { useAction } from '@/composables/useAction'

// Renders confirm() requests; mounted once, in App.vue.
const tone = computed(() => request.value?.tone ?? 'primary')
const icon = computed(
  () => request.value?.icon ?? (tone.value === 'primary' ? CircleHelp : TriangleAlert),
)
const { busy, error, run } = useAction(async () => {
  await request.value?.action?.()
  return true
})

// Kept apart from the request so the dialog can animate closed.
const open = ref(false)
watch(
  request,
  (value) => {
    open.value = value !== null
    error.value = null
  },
  { immediate: true },
)

function answer(confirmed: boolean) {
  request.value?.resolve(confirmed)
}

async function onConfirm() {
  if (await run()) answer(true)
}
</script>

<template>
  <AppDialog
    :model-value="open"
    :title="request?.title ?? ''"
    :icon="icon"
    :tone="tone"
    :persistent="busy"
    max-width="460"
    @update:model-value="(value) => value || answer(false)"
  >
    <p v-if="request?.text" class="text-body-medium mb-0" data-test="confirm-text">
      {{ request.text }}
    </p>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
      :text="error"
      data-test="confirm-error"
    />
    <template #actions>
      <v-btn variant="text" :disabled="busy" data-test="confirm-cancel" @click="answer(false)">
        {{ request?.cancelText ?? 'Cancel' }}
      </v-btn>
      <v-btn
        :color="tone"
        variant="flat"
        :loading="busy"
        data-test="confirm-accept"
        @click="onConfirm"
      >
        {{ request?.confirmText ?? 'Confirm' }}
      </v-btn>
    </template>
  </AppDialog>
</template>
