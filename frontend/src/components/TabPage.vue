<script setup lang="ts">
import { computed } from 'vue'

import FeaturePreview from '@/components/FeaturePreview.vue'
import PageHeader from '@/components/PageHeader.vue'
import { findNavItem, type NavName } from '@/navigation'

const props = defineProps<{ name: NavName }>()
const item = computed(() => findNavItem(props.name))
</script>

<template>
  <div>
    <PageHeader :item="item">
      <template v-if="$slots.actions" #actions><slot name="actions" /></template>
    </PageHeader>
    <slot>
      <FeaturePreview :item="item" />
    </slot>
  </div>
</template>
