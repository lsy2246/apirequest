<template>
  <div
    class="workbench-state"
    :class="`workbench-state-${kind}`"
    :role="kind === 'error' ? 'alert' : 'status'"
    :aria-busy="kind === 'loading'"
  >
    <span class="workbench-state-mark" aria-hidden="true">
      <HoppSmartSpinner v-if="kind === 'loading'" />
      <IconCircleAlert v-else-if="kind === 'error'" />
      <component :is="icon || IconInbox" v-else />
    </span>
    <strong>{{ title }}</strong>
    <p v-if="description">{{ description }}</p>
    <details v-if="detail" class="workbench-state-detail">
      <summary>{{ t("workbench.error_details") }}</summary>
      <pre>{{ detail }}</pre>
    </details>
    <div v-if="$slots.default" class="workbench-state-actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from "vue";
import { useI18n } from "~/composables/i18n";
import IconCircleAlert from "~icons/lucide/circle-alert";
import IconInbox from "~icons/lucide/inbox";

withDefaults(
  defineProps<{
    kind?: "loading" | "empty" | "error"
    title: string
    description?: string
    detail?: string
    icon?: Component
  }>(),
  { kind: "empty", description: "", detail: "", icon: undefined }
)
const t = useI18n()
</script>

<style scoped>
.workbench-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 180px;
  padding: 32px 20px;
  text-align: center;
}
.workbench-state-mark {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--primary-light-color);
  color: var(--secondary-light-color);
}
.workbench-state-mark > svg {
  width: 21px;
  height: 21px;
}
.workbench-state-error .workbench-state-mark {
  color: var(--status-critical-error-color);
}
.workbench-state strong {
  max-width: 100%;
  color: var(--secondary-dark-color);
  font-weight: 500;
  overflow-wrap: anywhere;
}
.workbench-state p {
  max-width: 34rem;
  color: var(--secondary-color);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.workbench-state-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
  margin-top: 4px;
}
.workbench-state-detail {
  width: 100%;
  max-width: 40rem;
  font-size: var(--font-size-tiny);
  color: var(--secondary-color);
}
.workbench-state-detail summary {
  cursor: pointer;
}
.workbench-state-detail pre {
  margin-top: 12px;
  padding: 12px;
  border-radius: 6px;
  background: var(--primary-light-color);
  text-align: left;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
</style>
