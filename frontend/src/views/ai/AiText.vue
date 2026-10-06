<script setup lang="ts">
import { computed } from 'vue'

import AiInline from '@/views/ai/AiInline.vue'
import { parseRichText } from '@/views/ai/richText'

/**
 * What the AI said, as paragraphs and lists. It's shown as text and never as HTML, so nothing in
 * an answer can put anything on the page.
 */
const props = defineProps<{ text: string }>()

const blocks = computed(() => parseRichText(props.text))
</script>

<template>
  <div class="ai-text text-body-medium" data-test="ai-text">
    <template v-for="(block, index) in blocks" :key="index">
      <p v-if="block.kind === 'paragraph'" class="ai-text__paragraph">
        <AiInline :parts="block.parts" />
      </p>
      <component :is="block.ordered ? 'ol' : 'ul'" v-else class="ai-text__list">
        <li v-for="(item, number) in block.items" :key="number">
          <AiInline :parts="item" />
        </li>
      </component>
    </template>
  </div>
</template>

<style scoped>
.ai-text {
  overflow-wrap: anywhere;
}

.ai-text__paragraph {
  margin: 0 0 8px;
  white-space: pre-line;
}

.ai-text__list {
  margin: 0 0 8px;
  padding-inline-start: 22px;
}

.ai-text > :last-child {
  margin-bottom: 0;
}
</style>
