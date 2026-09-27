<script setup lang="ts">
import { FolderPlus, Sparkles, Tags, Trash2 } from '@lucide/vue'
import { onMounted, ref } from 'vue'

import {
  addSuggestedCategories,
  deleteGroup,
  type Category,
  type CategoryGroup,
} from '@/api/categories'
import EmptyState from '@/components/ui/EmptyState.vue'
import ReadOnlyNotice from '@/components/ui/ReadOnlyNotice.vue'
import { confirmAndRun } from '@/composables/confirm'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useAuthStore } from '@/stores/auth'
import { useCategoriesStore } from '@/stores/categories'
import CategoryDialog from '@/views/settings/categories/CategoryDialog.vue'
import CategoryGroupCard from '@/views/settings/categories/CategoryGroupCard.vue'
import DeleteCategoryDialog from '@/views/settings/categories/DeleteCategoryDialog.vue'
import GroupDialog from '@/views/settings/categories/GroupDialog.vue'
import SettingsCard from '@/views/settings/SettingsCard.vue'

const auth = useAuthStore()
const store = useCategoriesStore()

// How many transactions each category has changes as they come in, so load them afresh.
onMounted(() => void store.load())

const groupOpen = ref(false)
const editingGroup = ref<CategoryGroup | null>(null)
const categoryOpen = ref(false)
const editingCategory = ref<Category | null>(null)
const categoryGroup = ref<string | null>(null)
const deleteOpen = ref(false)
const deleting = ref<Category | null>(null)

function addGroup() {
  editingGroup.value = null
  groupOpen.value = true
}

function editGroup(group: CategoryGroup) {
  editingGroup.value = group
  groupOpen.value = true
}

async function removeGroup(group: CategoryGroup) {
  const count = group.categories.length
  const done = await confirmAndRun(
    {
      title: `Delete ${group.name}?`,
      text: count
        ? `${count === 1 ? 'Its category goes' : `Its ${count} categories go`} too, and their transactions become uncategorized. This can't be undone.`
        : "It has no categories. This can't be undone.",
      confirmText: 'Delete group',
      tone: 'error',
      icon: Trash2,
    },
    () => deleteGroup(group.id),
  )
  if (!done) return
  await store.load()
  notify(`Deleted ${group.name}`)
}

function addCategory(group: CategoryGroup) {
  editingCategory.value = null
  categoryGroup.value = group.id
  categoryOpen.value = true
}

function editCategory(category: Category) {
  editingCategory.value = category
  categoryOpen.value = true
}

function removeCategory(category: Category) {
  deleting.value = category
  deleteOpen.value = true
}

const suggesting = useAction(async () => {
  const { added, groups } = await addSuggestedCategories()
  store.groups = groups
  if (!added) notify('You already have every suggested category')
  else notify(added === 1 ? 'Added 1 suggested category' : `Added ${added} suggested categories`)
})
</script>

<template>
  <ReadOnlyNotice
    v-if="!auth.isAdmin"
    text="You can see the categories. Only an admin can change them."
  />

  <SettingsCard
    title="Categories"
    subtitle="Sort transactions into categories, gathered in groups for budgets and reports."
    :icon="Tags"
  >
    <template v-if="auth.isAdmin && store.groups.length" #action>
      <v-btn
        color="primary"
        variant="flat"
        :prepend-icon="FolderPlus"
        data-test="group-add"
        @click="addGroup"
      >
        Add group
      </v-btn>
    </template>

    <v-alert
      v-if="store.error && !store.loaded"
      type="error"
      variant="tonal"
      :text="`Couldn't load the categories. ${store.error}`"
      data-test="categories-error"
    >
      <template #append>
        <v-btn variant="text" size="small" data-test="categories-retry" @click="store.load()">
          Try again
        </v-btn>
      </template>
    </v-alert>

    <div v-else-if="!store.loaded" class="category-groups" data-test="categories-loading">
      <v-skeleton-loader v-for="index in 4" :key="index" type="list-item@3" class="rounded-lg" />
    </div>

    <EmptyState
      v-else-if="!store.groups.length"
      :icon="Tags"
      title="No categories yet"
      :text="
        auth.isAdmin
          ? 'Start with a set that covers everyday spending, income and transfers, then make it your own.'
          : 'An admin hasn\'t set up any categories yet.'
      "
      compact
    >
      <template v-if="auth.isAdmin">
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="Sparkles"
          :loading="suggesting.busy.value"
          data-test="categories-suggest-first"
          @click="suggesting.run()"
        >
          Add suggested categories
        </v-btn>
        <v-btn variant="outlined" :prepend-icon="FolderPlus" @click="addGroup">Add a group</v-btn>
      </template>
    </EmptyState>

    <template v-else>
      <div class="category-groups">
        <CategoryGroupCard
          v-for="group in store.groups"
          :key="group.id"
          :group="group"
          @edit-group="editGroup"
          @delete-group="removeGroup"
          @add-category="addCategory"
          @edit-category="editCategory"
          @delete-category="removeCategory"
        />
      </div>
      <div
        v-if="auth.isAdmin"
        class="d-flex flex-wrap align-center ga-2 text-body-small text-medium-emphasis mt-4"
      >
        Deleted some of the suggested categories and want them back?
        <v-btn
          variant="text"
          size="small"
          color="primary"
          :prepend-icon="Sparkles"
          :loading="suggesting.busy.value"
          data-test="categories-suggest"
          @click="suggesting.run()"
        >
          Add them back
        </v-btn>
      </div>
    </template>

    <v-alert
      v-if="suggesting.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
      :text="suggesting.error.value"
      data-test="categories-suggest-error"
    />
  </SettingsCard>

  <template v-if="auth.isAdmin">
    <GroupDialog v-model="groupOpen" :group="editingGroup" />
    <CategoryDialog v-model="categoryOpen" :category="editingCategory" :group-id="categoryGroup" />
    <DeleteCategoryDialog v-if="deleting" v-model="deleteOpen" :category="deleting" />
  </template>
</template>

<style scoped>
.category-groups {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}
</style>
