<script setup lang="ts">
import { computed } from 'vue'

import type { Palette, ThemeScheme } from '@/theme/palettes'

/**
 * A small picture of the app in a palette's light or dark theme. With `against`, the other
 * theme fills the far corner, which is how Match device shows it follows the device.
 */
const props = defineProps<{ palette: Palette; scheme: ThemeScheme; against?: ThemeScheme }>()

/** One theme of the palette, painted by the custom properties the styles below read. */
function layerOf(scheme: ThemeScheme, key: number) {
  const colors = props.palette[scheme]
  return {
    key,
    style: {
      '--bg': colors.background,
      '--panel': colors.surface,
      '--ink': colors['on-surface-variant'],
      '--accent': colors.primary,
    },
  }
}

const layers = computed(() => {
  const list = [layerOf(props.scheme, 0)]
  if (props.against) list.push(layerOf(props.against, 1))
  return list
})
</script>

<template>
  <span class="theme-preview" aria-hidden="true" data-test="theme-preview">
    <span
      v-for="layer in layers"
      :key="layer.key"
      :class="['theme-preview__layer', { 'theme-preview__layer--far': layer.key === 1 }]"
      :style="layer.style"
    >
      <span class="theme-preview__side" />
      <span class="theme-preview__body">
        <span class="theme-preview__bar" />
        <span class="theme-preview__line" />
        <span class="theme-preview__line theme-preview__line--short" />
      </span>
    </span>
  </span>
</template>

<style scoped>
.theme-preview {
  position: relative;
  display: block;
  height: 96px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}

.theme-preview__layer {
  position: absolute;
  inset: 0;
  display: flex;
  background: var(--bg);
}

/* The far corner, cut along the diagonal. */
.theme-preview__layer--far {
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
}

.theme-preview__side {
  width: 28%;
  background: var(--panel);
}

.theme-preview__body {
  display: block;
  flex: 1;
  padding: 12px;
}

.theme-preview__bar {
  display: block;
  height: 10px;
  width: 50%;
  border-radius: 5px;
  background: var(--accent);
  margin-bottom: 10px;
}

.theme-preview__line {
  display: block;
  height: 8px;
  border-radius: 4px;
  background: var(--ink);
  opacity: 0.3;
  margin-bottom: 8px;
}

.theme-preview__line--short {
  width: 60%;
}
</style>
