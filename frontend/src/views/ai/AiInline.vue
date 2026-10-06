<script setup lang="ts">
import type { Inline } from '@/views/ai/richText'

/** A line of an answer: plain text, with bold and code where the AI wrote them. */
defineProps<{ parts: Inline[] }>()
</script>

<template>
  <template v-for="(part, index) in parts" :key="index">
    <strong v-if="part.bold">{{ part.text }}</strong>
    <code v-else-if="part.code" class="ai-text__code">{{ part.text }}</code>
    <template v-else>{{ part.text }}</template>
  </template>
</template>

<style scoped>
.ai-text__code {
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 0.875em;
  background: rgba(var(--v-theme-on-surface), 0.08);
}
</style>
