<template>
  <div v-if="embedded"><slot name="body" /></div>
  <HoppSmartModal v-else dialog :title="title" @close="emit('close')">
    <template #body><slot name="body" /></template>
    <template #footer><slot name="footer" /></template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
defineProps<{ embedded?: boolean; title: string }>()
const emit = defineEmits<{ (event: "close"): void }>()
</script>
