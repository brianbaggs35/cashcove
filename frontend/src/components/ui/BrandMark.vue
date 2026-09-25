<script setup lang="ts">
/** The Cashcove logo and name, linking home. */
withDefaults(defineProps<{ size?: number; subtitle?: string; to?: string }>(), {
  size: 38,
  subtitle: undefined,
  to: '/',
})
</script>

<template>
  <router-link :to="to" class="brand-mark d-inline-flex align-center ga-3" data-test="brand-mark">
    <img src="/favicon.svg" alt="" :width="size" :height="size" />
    <div>
      <div class="text-title-large font-weight-bold">Cashcove</div>
      <div v-if="subtitle" class="text-label-medium text-medium-emphasis">{{ subtitle }}</div>
    </div>
  </router-link>
</template>

<style scoped>
.brand-mark {
  color: inherit;
  text-decoration: none;
}
</style>
