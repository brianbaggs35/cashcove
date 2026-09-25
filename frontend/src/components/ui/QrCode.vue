<script setup lang="ts">
import { generate } from 'lean-qr'
import { toSvgPath } from 'lean-qr/extras/svg'
import { computed } from 'vue'

/** A QR code drawn as an inline SVG: crisp at any size and dark on light, as scanners need. */
const props = withDefaults(defineProps<{ value: string; size?: number; label?: string }>(), {
  size: 208,
  label: 'QR code',
})

// Four modules of light margin around the code, which scanners rely on to find it.
const MARGIN = 4
const code = computed(() => generate(props.value))
const path = computed(() => toSvgPath(code.value))
const span = computed(() => code.value.size + MARGIN * 2)
const viewBox = computed(() => `${-MARGIN} ${-MARGIN} ${span.value} ${span.value}`)
</script>

<template>
  <svg
    class="qr-code"
    :viewBox="viewBox"
    :width="size"
    :height="size"
    role="img"
    :aria-label="label"
    shape-rendering="crispEdges"
    data-test="qr-code"
  >
    <rect :x="-MARGIN" :y="-MARGIN" :width="span" :height="span" fill="#fff" />
    <path :d="path" fill="#0b1120" />
  </svg>
</template>

<style scoped>
.qr-code {
  display: block;
  border-radius: 16px;
  background: #fff;
}
</style>
