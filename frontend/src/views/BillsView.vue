<script setup lang="ts">
import SubscriptionsView from '@/views/SubscriptionsView.vue'
</script>

<template>
  <!-- Bills are tracked, matched and linked the same way as subscriptions, so it's the same page. -->
  <SubscriptionsView kind="bill" />
</template>
