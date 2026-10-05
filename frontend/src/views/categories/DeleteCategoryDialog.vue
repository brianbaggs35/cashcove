<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { deleteCategory, type Category } from '@/api/categories'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useCategoriesStore } from '@/stores/categories'

/**
 * Deletes a category. What used it goes back to being uncategorized, unless it's moved to
 * another category first. That's its transactions, and the subscriptions, bills and automations
 * that file things in it.
 */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ category: Category }>()

const store = useCategoriesStore()
const keep = ref<'move' | 'uncategorize'>('uncategorize')
const moveTo = ref<string | null>(null)

watch(open, (value) => {
  if (!value) return
  keep.value = 'uncategorize'
  moveTo.value = null
  deleting.clear()
})

const count = computed(() => props.category.transaction_count)
const ready = computed(() => !count.value || keep.value === 'uncategorize' || !!moveTo.value)

const deleting = useAction(async () => {
  const { category } = props
  const target = count.value && keep.value === 'move' ? moveTo.value : null
  await deleteCategory(category.id, target)
  await store.load()
  notify(`Deleted ${category.name}`)
  open.value = false
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="`Delete ${category.name}?`"
    :icon="Trash2"
    tone="error"
    :persistent="deleting.busy.value"
  >
    <template v-if="count">
      <p class="text-body-medium mt-0 mb-3">
        {{ count === 1 ? '1 transaction uses' : `${count} transactions use` }} it. What should
        happen to {{ count === 1 ? 'it' : 'them' }}?
      </p>
      <v-radio-group v-model="keep" color="primary" hide-details data-test="delete-category-keep">
        <v-radio value="uncategorize" label="Leave them uncategorized" />
        <v-radio value="move" label="Move them to another category" />
        <CategoryPicker
          v-if="keep === 'move'"
          v-model="moveTo"
          label="Move them to"
          :exclude="category.id"
          class="ms-10 mt-1 mb-2"
          data-test="delete-category-move-to"
        />
      </v-radio-group>
      <p class="text-body-small text-medium-emphasis mt-3 mb-0" data-test="delete-category-follows">
        Subscriptions, bills and automations that use it follow: they move with them, or are left
        uncategorized too.
      </p>
    </template>
    <p v-else class="text-body-medium ma-0" data-test="delete-category-unused">
      No transactions use it. Any subscriptions, bills or automations that do are left
      uncategorized. This can't be undone.
    </p>

    <v-alert
      v-if="deleting.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-4"
      :text="deleting.error.value"
      data-test="delete-category-error"
    />

    <template #actions>
      <v-btn variant="text" :disabled="deleting.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="error"
        variant="flat"
        :loading="deleting.busy.value"
        :disabled="!ready"
        data-test="delete-category-confirm"
        @click="deleting.run()"
      >
        Delete category
      </v-btn>
    </template>
  </AppDialog>
</template>
