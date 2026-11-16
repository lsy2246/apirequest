<template>
  <div class="min-w-0">
    <SelectRoot
      :model-value="selected ? optionValue(modelValue) : undefined"
      :open="open"
      :disabled="disabled"
      @update:model-value="choose"
      @update:open="setOpen"
    >
      <SelectTrigger as-child>
        <button
          ref="trigger"
          type="button"
          class="select-trigger"
          :disabled="disabled"
          :aria-label="label"
        >
          <component
            :is="selected?.icon"
            v-if="selected?.icon"
            class="shrink-0"
          />
          <SelectValue
            :placeholder="placeholder"
            class="min-w-0 flex-1 text-left"
          >
            <span :style="{ color: selected?.color }">
              {{ selected?.label || placeholder }}
            </span>
          </SelectValue>
          <SelectIcon as-child>
            <IconChevron
              class="shrink-0 text-secondaryLight transition-transform"
              :class="{ 'rotate-180': open }"
            />
          </SelectIcon>
        </button>
      </SelectTrigger>
      <SelectPortal>
        <SelectContent
          class="workbench-select-content"
          position="popper"
          align="start"
          :side-offset="6"
          :collision-padding="12"
          :aria-label="label"
          @escape-key-down="onEscape"
        >
          <SelectViewport class="p-1">
            <SelectItem
              v-for="option in options"
              :key="option.value"
              :value="optionValue(option.value)"
              :text-value="option.label"
              class="select-option"
            >
              <component
                :is="option.icon"
                v-if="option.icon"
                class="shrink-0"
              />
              <SelectItemText class="min-w-0 flex-1 break-words">
                <span :style="{ color: option.color }">{{ option.label }}</span>
              </SelectItemText>
              <SelectItemIndicator class="ml-auto text-accent">
                <IconCheck />
              </SelectItemIndicator>
            </SelectItem>
          </SelectViewport>
        </SelectContent>
      </SelectPortal>
    </SelectRoot>
  </div>
</template>

<script setup lang="ts" generic="T extends string">
import { computed, ref, type Component } from "vue";
import { useEventListener } from "@vueuse/core";
import { SelectContent, SelectIcon, SelectItem, SelectItemIndicator, SelectItemText, SelectPortal, SelectRoot, SelectTrigger, SelectValue, SelectViewport, type AcceptableValue } from "reka-ui";
import IconChevron from "~icons/lucide/chevron-down";
import IconCheck from "~icons/lucide/check";

const props = defineProps<{
  modelValue: T
  options: readonly {
    value: T
    label: string
    color?: string
    icon?: Component
  }[]
  label: string
  placeholder?: string
  disabled?: boolean
}>()
const emit = defineEmits<{ "update:modelValue": [T] }>()
const trigger = ref<HTMLButtonElement>()
const open = ref(false)
const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue)
)

function setOpen(value: boolean) {
  // A disabled fieldset also disables its native trigger.
  if (value && trigger.value?.matches(":disabled")) return
  open.value = value
}

function choose(value: AcceptableValue) {
  if (typeof value !== "string") return
  const option = props.options.find(
    (option) => optionValue(option.value) === value
  )
  if (option) emit("update:modelValue", option.value)
}

// Existing capture settings use an empty string for "automatic" / "all".
// Reka reserves empty item values for clearing, so encode them internally.
function optionValue(value: string) {
  return `value:${value}`
}

function onEscape(event: KeyboardEvent) {
  // Dismiss this menu without also dismissing its containing dialog.
  event.stopPropagation()
}

// The existing modal listens on document before the portalled menu mounts.
// Handle Escape in capture so one press only closes the innermost control.
useEventListener(
  window,
  "keydown",
  (event) => {
    if (!open.value || event.key !== "Escape") return
    event.preventDefault()
    event.stopImmediatePropagation()
    open.value = false
  },
  { capture: true }
)
</script>

<style scoped>
.select-trigger {
  @apply flex min-h-9 w-full items-center gap-2 border border-divider bg-primary px-3 py-2 text-secondaryDark transition hover:border-dividerDark disabled:cursor-not-allowed disabled:opacity-50;
  border-radius: var(--workbench-radius);
}
.select-trigger:focus-visible,
.select-trigger[data-state="open"] {
  outline: 2px solid var(--accent-color);
  outline-offset: 2px;
}
</style>

<!-- Reka portals content through a fragment; popup styles must not depend on the SFC scope attribute. -->
<style>
.workbench-select-content {
  z-index: 10020;
  width: max(176px, var(--reka-select-trigger-width));
  max-width: min(
    calc(100vw - 24px),
    var(--reka-select-content-available-width)
  );
  max-height: min(20rem, var(--reka-select-content-available-height));
  overflow-y: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--divider-color);
  border-radius: 9px;
  background: var(--popover-color);
  color: var(--secondary-dark-color);
  box-shadow: var(--workbench-shadow);
  font: var(--font-size-body) / var(--line-height-body) var(--font-sans);
}
.workbench-select-content .select-option {
  @apply relative flex min-h-9 select-none items-center gap-3 px-3 py-2 text-left outline-none;
  border-radius: 5px;
  cursor: pointer;
}
.workbench-select-content .select-option[data-highlighted] {
  background: var(--primary-light-color);
}
.workbench-select-content .select-option[data-state="checked"] {
  color: var(--accent-color);
  background: var(--primary-light-color);
}
</style>
