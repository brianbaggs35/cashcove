<script setup lang="ts">
import { ArrowLeft, ChevronRight } from '@lucide/vue'
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useDisplay } from 'vuetify'

/**
 * Where a page sits: the pages above it, each a link back to it, then this one. A phone has no
 * room for the whole trail, so it offers the way back to the page just above instead. Meant for
 * any page that is inside another, such as one bill inside the Bills tab.
 */
const props = defineProps<{
  /** The pages above this one, the broadest first. There is always at least one. */
  trail: { title: string; to: RouteLocationRaw }[]
  /** This page, which isn't a link. */
  current: string
}>()

const { xs } = useDisplay()
/** The page one level up. */
const parent = computed(() => props.trail.at(-1) as (typeof props.trail)[number])
const items = computed(() => [
  ...props.trail,
  // Marked as the page being read, to say so to a screen reader.
  { title: props.current, active: true },
])
</script>

<template>
  <nav aria-label="Breadcrumb" class="crumbs">
    <v-btn
      v-if="xs"
      :to="parent.to"
      variant="text"
      color="primary"
      :prepend-icon="ArrowLeft"
      :aria-label="`Back to ${parent.title}`"
      class="crumbs__back"
      data-test="breadcrumb-back"
    >
      {{ parent.title }}
    </v-btn>
    <v-breadcrumbs v-else :items="items" density="comfortable" data-test="breadcrumb-trail">
      <template #divider>
        <ChevronRight :size="16" aria-hidden="true" />
      </template>
    </v-breadcrumbs>
  </nav>
</template>

<style scoped>
/* Lines the arrow of the back button up with the page's edge, not with the button's padding. */
.crumbs__back {
  margin-inline-start: -12px;
}

.crumbs :deep(.v-breadcrumbs) {
  align-items: center;
  padding: 0;
  font-size: 0.875rem;
}

.crumbs :deep(.v-breadcrumbs-item) {
  padding: 0;
}

.crumbs :deep(.v-breadcrumbs-item--link) {
  display: inline-flex;
  align-items: center;
  /* Big enough to hit, as it is the way back. */
  min-height: 32px;
  padding-inline: 8px;
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
  border-radius: 8px;
}

.crumbs :deep(.v-breadcrumbs-item--link:hover) {
  background: rgba(var(--v-theme-primary), 0.08);
}

.crumbs :deep(.v-breadcrumbs-item--link:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

/* Vuetify fades the current page like something switched off, which is too faint to read. */
.crumbs :deep(.v-breadcrumbs-item--disabled) {
  min-width: 0;
  padding-inline: 8px;
  overflow: hidden;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 1;
}

.crumbs :deep(.v-breadcrumbs-divider) {
  display: inline-flex;
  align-items: center;
  padding: 0;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}
</style>
