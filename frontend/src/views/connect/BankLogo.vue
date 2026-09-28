<script setup lang="ts">
import { Landmark } from '@lucide/vue'
import { computed } from 'vue'

import type { Connection } from '@/api/connections'

/** The bank's logo from Plaid, or a bank icon in the bank's own color when it has none. */
const props = withDefaults(
  defineProps<{
    connection: Pick<Connection, 'institution_logo' | 'institution_color'>
    size?: number
  }>(),
  { size: 48 },
)

const logo = computed(() =>
  props.connection.institution_logo
    ? `data:image/png;base64,${props.connection.institution_logo}`
    : null,
)
const style = computed(() => ({
  '--bank-color': props.connection.institution_color ?? 'rgb(var(--v-theme-primary))',
  width: `${props.size}px`,
  height: `${props.size}px`,
}))
</script>

<template>
  <div class="bank-logo" :style="style" data-test="bank-logo">
    <img v-if="logo" :src="logo" alt="" class="bank-logo__image" />
    <v-icon v-else :icon="Landmark" :size="Math.round(size / 2)" class="bank-logo__icon" />
  </div>
</template>

<style scoped>
.bank-logo {
  position: relative;
  display: grid;
  flex-shrink: 0;
  place-items: center;
  overflow: hidden;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  box-shadow: inset 0 -3px 0 var(--bank-color);
}

.bank-logo__image {
  width: 72%;
  height: 72%;
  object-fit: contain;
}

.bank-logo__icon {
  color: var(--bank-color);
}
</style>
