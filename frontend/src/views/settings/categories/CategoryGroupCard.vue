<script setup lang="ts">
import { EllipsisVertical, Pencil, Plus, Trash2 } from '@lucide/vue'
import { computed } from 'vue'

import type { Category, CategoryGroup } from '@/api/categories'
import { categoryKind } from '@/components/finance/categoryKinds'
import { useAuthStore } from '@/stores/auth'

/** A group and its categories, each linking to its transactions. Admins can change them. */
const props = defineProps<{ group: CategoryGroup }>()
const emit = defineEmits<{
  editGroup: [group: CategoryGroup]
  deleteGroup: [group: CategoryGroup]
  addCategory: [group: CategoryGroup]
  editCategory: [category: Category]
  deleteCategory: [category: Category]
}>()

const auth = useAuthStore()
const kind = computed(() => categoryKind(props.group.kind))
const headingId = computed(() => `category-group-${props.group.id}`)

function uses(category: Category): string {
  const count = category.transaction_count
  if (!count) return 'No transactions'
  return count === 1 ? '1 transaction' : `${count.toLocaleString()} transactions`
}
</script>

<template>
  <section
    class="category-group d-flex flex-column pa-2"
    :aria-labelledby="headingId"
    :data-test="`category-group-${group.id}`"
  >
    <div class="d-flex align-center ga-2 ps-2 pt-1 pb-1">
      <h3 :id="headingId" class="text-title-small font-weight-bold text-truncate ma-0">
        {{ group.name }}
      </h3>
      <v-chip
        size="x-small"
        variant="tonal"
        :color="kind.color"
        :prepend-icon="kind.icon"
        data-test="category-group-kind"
      >
        {{ kind.title }}
      </v-chip>
      <v-spacer />
      <v-menu v-if="auth.isAdmin" location="bottom end">
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :icon="EllipsisVertical"
            variant="text"
            size="small"
            :aria-label="`Actions for ${group.name}`"
            data-test="category-group-actions"
          />
        </template>
        <v-list density="compact" nav min-width="200">
          <v-list-item
            :prepend-icon="Pencil"
            title="Edit group"
            data-test="category-group-edit"
            @click="emit('editGroup', group)"
          />
          <v-list-item
            :prepend-icon="Trash2"
            title="Delete group"
            base-color="error"
            data-test="category-group-delete"
            @click="emit('deleteGroup', group)"
          />
        </v-list>
      </v-menu>
    </div>

    <div
      v-for="category in group.categories"
      :key="category.id"
      class="category-row d-flex align-center"
      data-test="category-row"
    >
      <router-link
        :to="{ path: '/transactions', query: { category: category.id } }"
        class="category-row__main d-flex align-center ga-3 flex-grow-1 py-2 px-2"
        :aria-label="`${category.name}: ${uses(category)}. See them`"
        data-test="category-link"
      >
        <span class="category-row__emoji" aria-hidden="true">{{ category.emoji }}</span>
        <span class="text-body-medium font-weight-medium text-break flex-grow-1">
          {{ category.name }}
        </span>
        <span class="text-body-small text-medium-emphasis text-no-wrap">
          {{ uses(category) }}
        </span>
      </router-link>
      <v-menu v-if="auth.isAdmin" location="bottom end">
        <template #activator="{ props: activator }">
          <v-btn
            v-bind="activator"
            :icon="EllipsisVertical"
            variant="text"
            size="x-small"
            :aria-label="`Actions for ${category.name}`"
            data-test="category-actions"
          />
        </template>
        <v-list density="compact" nav min-width="180">
          <v-list-item
            :prepend-icon="Pencil"
            title="Edit"
            data-test="category-edit"
            @click="emit('editCategory', category)"
          />
          <v-list-item
            :prepend-icon="Trash2"
            title="Delete"
            base-color="error"
            data-test="category-delete"
            @click="emit('deleteCategory', category)"
          />
        </v-list>
      </v-menu>
    </div>
    <p v-if="!group.categories.length" class="text-body-small text-medium-emphasis px-2 my-2">
      No categories in this group yet.
    </p>

    <v-btn
      v-if="auth.isAdmin"
      variant="text"
      size="small"
      color="primary"
      :prepend-icon="Plus"
      class="align-self-start mt-auto"
      data-test="category-add"
      @click="emit('addCategory', group)"
    >
      Add category
    </v-btn>
  </section>
</template>

<style scoped>
.category-group {
  border-radius: 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.category-row {
  border-radius: 10px;
  transition: background-color 0.15s;
}

.category-row:hover,
.category-row:focus-within {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.category-row__main {
  min-width: 0;
  color: inherit;
  text-decoration: none;
  border-radius: 10px;
}

.category-row__main:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}

.category-row__emoji {
  font-size: 1.15rem;
  line-height: 1;
  width: 1.5rem;
  text-align: center;
}
</style>
