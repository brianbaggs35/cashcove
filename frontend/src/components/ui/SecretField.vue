<script setup lang="ts">
import { Eye, EyeOff } from '@lucide/vue'
import { ref } from 'vue'

/**
 * A field for a secret that isn't a password, like a provider's API key: hidden as it's typed,
 * with a way to see it, and never offered to a password manager, which would offer to fill in
 * someone's sign-in password here.
 */
withDefaults(
  defineProps<{
    label: string
    hint?: string
    errorMessages?: string | string[]
    testId?: string
  }>(),
  { hint: undefined, errorMessages: () => [], testId: 'secret' },
)

const secret = defineModel<string>({ required: true })
const visible = ref(false)
</script>

<template>
  <v-text-field
    v-model="secret"
    :label="label"
    :type="visible ? 'text' : 'password'"
    :hint="hint"
    :persistent-hint="!!hint"
    :error-messages="errorMessages"
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    :data-test="testId"
  >
    <template #append-inner>
      <v-btn
        :icon="visible ? EyeOff : Eye"
        variant="text"
        size="small"
        density="comfortable"
        :aria-label="
          visible ? `Hide the ${label.toLowerCase()}` : `Show the ${label.toLowerCase()}`
        "
        :aria-pressed="visible"
        :data-test="`${testId}-toggle`"
        @click="visible = !visible"
      />
    </template>
  </v-text-field>
</template>
