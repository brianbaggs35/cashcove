<script setup lang="ts">
import { computed } from 'vue'

import type { AccountType } from '@/api/accounts'
import { accountGroup, accountType } from '@/components/finance/accountTypes'

/** An account's type as an icon, colored by the group it's listed under. */
const props = withDefaults(defineProps<{ type: AccountType; size?: number | string }>(), {
  size: 40,
})
const info = computed(() => accountType(props.type))
const color = computed(() => accountGroup(props.type).color)
</script>

<template>
  <v-avatar :color="color" variant="tonal" rounded="lg" :size="size" data-test="account-avatar">
    <v-icon :icon="info.icon" :size="Math.round(Number(size) / 2)" />
  </v-avatar>
</template>
