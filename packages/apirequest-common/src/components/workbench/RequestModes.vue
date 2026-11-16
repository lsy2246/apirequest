<template>
  <div
    class="workbench-request-modes flex shrink-0 items-center gap-1 overflow-x-auto border-b border-dividerLight bg-primary px-4 py-2.5"
  >
    <div role="tablist" class="flex shrink-0 gap-1">
      <button
        v-for="mode in visibleModes"
        :key="mode.id"
        type="button"
        role="tab"
        :aria-selected="modelValue === mode.id"
        class="rounded-md px-3 py-1.5 text-body transition hover:bg-primaryLight"
        :class="
          modelValue === mode.id
            ? 'bg-primaryLight font-medium text-accent'
            : 'text-secondary'
        "
        @click="$emit('update:modelValue', mode.id)"
      >
        {{ t(mode.label) }}
      </button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from "~/composables/i18n"
import { computed } from "vue"
import { useDocumentationVisibility } from "~/composables/documentationVisibility"
export type RequestMode =
  "design" | "debug" | "documentation" | "cases" | "load" | "settings"
defineProps<{ modelValue: RequestMode }>()
defineEmits<{
  (event: "update:modelValue", value: RequestMode): void
}>()
const t = useI18n()
const { isDocumentationVisible } = useDocumentationVisibility()
const modes: { id: RequestMode; label: string }[] = [
  { id: "debug", label: "workbench.debug" },
  { id: "design", label: "workbench.design" },
  { id: "documentation", label: "workbench.request_documentation" },
  { id: "cases", label: "workbench.request_cases" },
  { id: "load", label: "workbench.load_test" },
  { id: "settings", label: "navigation.settings" },
]
const visibleModes = computed(() =>
  modes.filter(
    (mode) => mode.id !== "documentation" || isDocumentationVisible.value
  )
)
</script>

<style scoped>
button:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
</style>
