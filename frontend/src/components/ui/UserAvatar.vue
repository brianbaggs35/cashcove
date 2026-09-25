<script lang="ts">
/** Avatar colours, each dark enough for white initials to meet WCAG AA contrast (4.5:1). */
export const AVATAR_COLORS = [
  '#0f766e',
  '#4f46e5',
  '#b45309',
  '#be185d',
  '#0369a1',
  '#7c3aed',
  '#15803d',
]

/** For someone whose account is turned off. */
export const MUTED_AVATAR_COLOR = '#64748b'
</script>

<script setup lang="ts">
import { computed } from 'vue'

/** Initials on a colour picked from the name, so each person keeps the same one. */
const props = withDefaults(
  defineProps<{ name: string; size?: number | string; muted?: boolean }>(),
  { size: 40, muted: false },
)

/** The first letters of the first and last names, e.g. "AM" for Alex Morgan. */
const initials = computed(() => {
  const letters = Array.from(props.name.matchAll(/(?:^|\s)(\S)/gu), (match) => match[1])
  const picked = letters.length > 1 ? [letters[0], letters.at(-1)] : letters
  return picked.join('').toUpperCase() || '?'
})

const color = computed(() => {
  if (props.muted) return MUTED_AVATAR_COLOR
  let hash = 0
  for (let index = 0; index < props.name.length; index++) {
    hash = (hash * 31 + props.name.charCodeAt(index)) >>> 0
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
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
