<script setup lang="ts">
import { computed, onScopeDispose, ref } from 'vue'

import { formatDateTime, formatRelative } from '@/utils/format'

/** "5 minutes ago", kept current, with the exact time on hover. */
const props = defineProps<{ value: string }>()

const now = ref(new Date())
const timer = setInterval(() => (now.value = new Date()), 30_000)
onScopeDispose(() => {
  clearInterval(timer)
})

const relative = computed(() => formatRelative(props.value, now.value))
const exact = computed(() => formatDateTime(props.value))
</script>

<template>
  <time :datetime="value" :title="exact">{{ relative }}</time>
</template>
