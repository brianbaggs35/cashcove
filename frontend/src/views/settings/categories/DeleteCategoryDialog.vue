<script setup lang="ts">
import { Trash2 } from '@lucide/vue'
import { computed, ref, watch } from 'vue'

import { deleteCategory, type Category } from '@/api/categories'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'
import { useCategoriesStore } from '@/stores/categories'

/** Deletes a category, first asking where its transactions should go. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ category: Category }>()

const store = useCategoriesStore()
const keep = ref<'move' | 'uncategorize'>('move')
const moveTo = ref<string | null>(null)

watch(open, (value) => {
  if (!value) return
  keep.value = 'move'
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
        {{ count === 1 ? '1 transaction uses' : `${count} transactions use` }} it. Where should
        {{ count === 1 ? 'it' : 'they' }} go?
      </p>
      <v-radio-group v-model="keep" color="primary" hide-details data-test="delete-category-keep">
        <v-radio value="move" label="Move them to another category" />
        <CategoryPicker
          v-if="keep === 'move'"
          v-model="moveTo"
          label="Move them to"
          :exclude="category.id"
          class="ms-10 mt-1 mb-2"
          data-test="delete-category-move-to"
        />
        <v-radio value="uncategorize" label="Leave them uncategorized" />
      </v-radio-group>
    </template>
    <p v-else class="text-body-medium ma-0">No transactions use it. This can't be undone.</p>

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
