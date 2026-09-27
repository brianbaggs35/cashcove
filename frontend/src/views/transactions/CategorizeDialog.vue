<script setup lang="ts">
import { Tags } from '@lucide/vue'
import { ref, watch } from 'vue'

import { categorizeTransactions } from '@/api/transactions'
import CategoryPicker from '@/components/finance/CategoryPicker.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { notify } from '@/composables/notify'
import { useAction } from '@/composables/useAction'

/** Gives the selected transactions one category, or takes theirs away. */
const open = defineModel<boolean>({ required: true })
const props = defineProps<{ ids: string[] }>()
const emit = defineEmits<{ done: [] }>()

const category = ref<string | null>(null)

watch(open, (value) => {
  if (value) {
    category.value = null
    saving.clear()
  }
})

const saving = useAction(async () => {
  const { count } = await categorizeTransactions(props.ids, category.value)
  const what = count === 1 ? '1 transaction' : `${count} transactions`
  notify(category.value ? `Categorized ${what}` : `${what} now uncategorized`)
  emit('done')
  open.value = false
})
</script>

<template>
  <AppDialog
    v-model="open"
    :title="ids.length === 1 ? 'Categorize 1 transaction' : `Categorize ${ids.length} transactions`"
    subtitle="Leave the category empty to take theirs away."
    :icon="Tags"
    :persistent="saving.busy.value"
  >
    <CategoryPicker v-model="category" data-test="categorize-category" />
    <v-alert
      v-if="saving.error.value"
      type="error"
      variant="tonal"
      density="compact"
      class="mt-2"
      :text="saving.error.value"
      data-test="categorize-error"
    />
    <template #actions>
      <v-btn variant="text" :disabled="saving.busy.value" @click="open = false">Cancel</v-btn>
      <v-btn
        color="primary"
        variant="flat"
        :loading="saving.busy.value"
        data-test="categorize-apply"
        @click="saving.run()"
      >
        Apply
      </v-btn>
    </template>
  </AppDialog>
</template>
