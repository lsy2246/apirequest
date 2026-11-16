<template>
  <button
    type="button"
    role="switch"
    :aria-checked="checked"
    :disabled="disabled"
    class="workbench-toggle"
    @click="toggle"
  >
    <span class="workbench-toggle-track" aria-hidden="true">
      <span class="workbench-toggle-thumb" />
    </span>
    <span v-if="$slots.default" class="workbench-toggle-label"><slot /></span>
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue"

const props = withDefaults(
  defineProps<{
    modelValue?: boolean
    on?: boolean
    disabled?: boolean
  }>(),
  { modelValue: undefined, on: undefined, disabled: false }
)
const emit = defineEmits<{
  (event: "update:modelValue", value: boolean): void
  (event: "change", value: boolean): void
}>()
const checked = computed(() => props.modelValue ?? props.on ?? false)
function toggle() {
  if (props.disabled) return
  const next = !checked.value
  emit("update:modelValue", next)
  emit("change", next)
}
</script>

<style scoped>
.workbench-toggle {
  display: inline-flex;
  min-width: 36px;
  min-height: 28px;
  max-width: 100%;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  color: var(--secondary-color);
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.workbench-toggle-track {
  display: inline-flex;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
  align-items: center;
  padding: 2px;
  border-radius: 999px;
  background: var(--divider-dark-color);
  transition: background-color 140ms;
}
.workbench-toggle-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px #0002;
  transition: transform 140ms;
}
.workbench-toggle[aria-checked="true"] .workbench-toggle-track {
  background: var(--accent-color);
}
.workbench-toggle[aria-checked="true"] .workbench-toggle-thumb {
  transform: translateX(16px);
}
.workbench-toggle-label {
  min-width: 0;
  overflow-wrap: anywhere;
}
.workbench-toggle:focus-visible {
  outline: 2px solid var(--accent-color);
  outline-offset: 3px;
}
.workbench-toggle:disabled,
.workbench-toggle:disabled .workbench-toggle-track {
  cursor: not-allowed;
}
.workbench-toggle:disabled {
  opacity: 0.5;
}
@media (prefers-reduced-motion: reduce) {
  .workbench-toggle-track,
  .workbench-toggle-thumb {
    transition: none;
  }
}
</style>
