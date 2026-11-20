<template>
  <div v-if="embedded"><slot name="body" /></div>
  <HoppSmartModal
    v-else
    dialog
    :title="title"
    :styles="wide ? '!w-[calc(100%_-_2rem)] sm:max-w-5xl' : undefined"
    @close="emit('close')"
  >
    <template #body><slot name="body" /></template>
    <template #footer><slot name="footer" /></template>
  </HoppSmartModal>
</template>

<script setup lang="ts">
defineProps<{ embedded?: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ (event: "close"): void }>()
</script>
