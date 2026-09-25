<script setup lang="ts">
/** Six boxes for a code from an authenticator app; pasting or autofill fills them all. */
withDefaults(
  defineProps<{ disabled?: boolean; error?: boolean; autofocus?: boolean; label?: string }>(),
  { disabled: false, error: false, autofocus: true, label: 'Six-digit code' },
)
const code = defineModel<string>({ required: true })
const emit = defineEmits<{ complete: [code: string] }>()
</script>

<template>
  <v-otp-input
    v-model="code"
    length="6"
    type="number"
    :disabled="disabled"
    :error="error"
    :autofocus="autofocus"
    :aria-label="label"
    class="code-input"
    data-test="code-input"
    @finish="(value: string) => emit('complete', value)"
  />
</template>

<style scoped>
.code-input {
  padding: 0;
}

.code-input :deep(input) {
  font-size: 1.375rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
