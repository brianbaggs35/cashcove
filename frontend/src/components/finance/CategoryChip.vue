<script setup lang="ts">
import { CircleDashed } from '@lucide/vue'
import { computed } from 'vue'

import { categoryKind } from '@/components/finance/categoryKinds'
import { useCategoriesStore } from '@/stores/categories'

/** A transaction's category, its emoji and name, or that it has none yet. */
const props = withDefaults(
  defineProps<{ categoryId: string | null; size?: 'x-small' | 'small' | 'default' }>(),
  { size: 'small' },
)

const category = computed(() => useCategoriesStore().find(props.categoryId))
</script>

<template>
  <v-chip
    v-if="category"
    :size="size"
    :color="categoryKind(category.group.kind).color"
    variant="tonal"
    class="category-chip"
    data-test="category-chip"
  >
    <span class="me-1" aria-hidden="true">{{ category.emoji }}</span>
    <span class="text-truncate">{{ category.name }}</span>
  </v-chip>
  <v-chip
    v-else
    :size="size"
    variant="outlined"
    :prepend-icon="CircleDashed"
    class="category-chip category-chip--none text-medium-emphasis"
    data-test="category-chip"
  >
    Uncategorized
  </v-chip>
</template>

<style scoped>
.category-chip {
  max-width: 100%;
}

.category-chip--none {
  border-style: dashed;
}
</style>
