<script setup lang="ts">
import { Save, Undo2 } from '@lucide/vue'

defineProps<{ visible: boolean; saving: boolean }>()
const emit = defineEmits<{ save: []; discard: [] }>()
</script>

<template>
  <v-slide-y-reverse-transition>
    <div v-if="visible" class="save-bar" data-test="save-bar">
      <v-card elevation="8" class="d-flex flex-wrap align-center ga-3 pa-3 ps-5" rounded="xl">
        <span class="text-body-medium font-weight-medium me-auto">You have unsaved changes</span>
        <v-btn variant="text" :prepend-icon="Undo2" data-test="discard" @click="emit('discard')">
          Discard
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :prepend-icon="Save"
          :loading="saving"
          data-test="save"
          @click="emit('save')"
        >
          Save changes
        </v-btn>
      </v-card>
    </div>
  </v-slide-y-reverse-transition>
</template>

<style scoped>
.save-bar {
  position: fixed;
  inset-inline: 16px;
  bottom: calc(24px + var(--v-layout-bottom, 0px));
  z-index: 1010;
  display: flex;
  justify-content: center;
  pointer-events: none;
}

.save-bar > * {
  pointer-events: auto;
  width: min(560px, 100%);
}
</style>
