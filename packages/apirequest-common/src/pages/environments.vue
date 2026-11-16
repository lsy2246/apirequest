<template>
  <WorkbenchPage>
    <header class="workbench-page-header">
      <h1 class="text-xl font-semibold text-secondaryDark">
        {{ t("tab.environments") }}
      </h1>
    </header>
    <div
      ref="environmentList"
      class="workbench-panel workbench-environment-panel"
    />
  </WorkbenchPage>
</template>

<script setup lang="ts">
import WorkbenchPage from "~/components/workbench/Page.vue";
import { inject, onBeforeUnmount, onMounted, useTemplateRef } from "vue";
import { environmentManagerTargetKey } from "~/composables/environmentManagerTarget";
import { useI18n } from "~/composables/i18n";

const t = useI18n()
const environmentList = useTemplateRef<HTMLElement>("environmentList")
const target = inject(environmentManagerTargetKey)!

onMounted(() => {
  target.value = environmentList.value
})

onBeforeUnmount(() => {
  target.value = null
})
</script>
