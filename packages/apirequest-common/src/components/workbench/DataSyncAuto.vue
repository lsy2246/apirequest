<template><span v-if="false" /></template>
<script setup lang="ts">
import { onMounted, onBeforeUnmount } from "vue";
import { loadSyncState, startAutoSync } from "~/helpers/data-sync/engine";
let stop: (() => void) | undefined,
  alive = true
onMounted(async () => {
  try {
    await loadSyncState()
    if (alive) stop = startAutoSync()
  } catch {
    /* 设置页会显示持久化读取错误。 */
  }
})
onBeforeUnmount(() => {
  alive = false
  stop?.()
})
</script>
