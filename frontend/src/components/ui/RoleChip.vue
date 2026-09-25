<script setup lang="ts">
import { Crown, Eye } from '@lucide/vue'

import type { Role } from '@/api/auth'

defineProps<{ role: Role; size?: 'x-small' | 'small' | 'default' }>()

const roles = {
  admin: { title: 'Admin', icon: Crown, color: 'primary' },
  viewer: { title: 'Viewer', icon: Eye, color: 'secondary' },
} as const
</script>

<template>
  <v-chip
    :color="roles[role].color"
    :prepend-icon="roles[role].icon"
    :size="size ?? 'small'"
    variant="tonal"
    class="font-weight-medium"
    :data-test="`role-${role}`"
  >
    {{ roles[role].title }}
  </v-chip>
</template>
