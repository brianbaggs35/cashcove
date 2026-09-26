<script setup lang="ts">
/**
 * Tells password managers which account a new password belongs to, on forms where the email
 * isn't one of the fields people fill in. It's never shown.
 */
defineProps<{ email: string }>()
</script>

<template>
  <div hidden>
    <label for="username-hint">Email</label>
    <input
      id="username-hint"
      type="email"
      name="username"
      autocomplete="username"
      :value="email"
      readonly
    />
  </div>
</template>
