<script setup lang="ts">
import { computed } from 'vue'

/** Initials on a colour picked from the name, so each person keeps the same one. */
const props = withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 40 })

const PALETTE = ['#0d9488', '#6366f1', '#d97706', '#db2777', '#0284c7', '#7c3aed', '#16a34a']

/** The first letters of the first and last names, e.g. "AM" for Alex Morgan. */
const initials = computed(() => {
  const letters = Array.from(props.name.matchAll(/(?:^|\s)(\S)/gu), (match) => match[1])
  const picked = letters.length > 1 ? [letters[0], letters.at(-1)] : letters
  return picked.join('').toUpperCase() || '?'
})

const color = computed(() => {
  let hash = 0
  for (let index = 0; index < props.name.length; index++) {
    hash = (hash * 31 + props.name.charCodeAt(index)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
})
</script>

<template>
  <v-avatar :size="size" :color="color" class="user-avatar" aria-hidden="true">
    <span class="user-avatar__initials">{{ initials }}</span>
  </v-avatar>
</template>

<style scoped>
.user-avatar {
  color: #fff;
}

.user-avatar__initials {
  font-weight: 700;
  font-size: 0.8125em;
  letter-spacing: 0.02em;
}
</style>
