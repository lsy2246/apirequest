<template>
  <HoppButtonSecondary
    v-if="isLocalWorkbench()"
    v-tippy="{ theme: 'tooltip' }"
    :icon="stacked ? IconRows : IconColumns"
    :title="t(stacked ? 'layout.switch_to_row' : 'layout.switch_to_column')"
    :aria-label="
      t(stacked ? 'layout.switch_to_row' : 'layout.switch_to_column')
    "
    class="request-layout-toggle shrink-0 !rounded-none border-r border-dividerLight"
    @click="stacked = !stacked"
  />
</template>
<script setup lang="ts">
import IconRows from "~icons/lucide/rows-2";
import IconColumns from "~icons/lucide/columns-2";
import { useI18n } from "~/composables/i18n";
import { useSetting } from "~/composables/settings";
import { isLocalWorkbench } from "~/platform";

const t = useI18n()
// 调试现场直接操作同一份布局偏好，由现有分栏组件负责调整和持久化。
const stacked = useSetting("COLUMN_LAYOUT")
</script>
