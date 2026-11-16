<template>
  <div data-testid="config-picker">
    <div class="mb-3 flex items-center justify-between gap-3">
      <h4 class="font-medium text-secondaryDark">选择数据</h4>
      <button
        type="button"
        class="text-accent"
        :disabled="disabled"
        @click="toggleAll"
      >
        {{ allSelected ? "取消全选" : "全选" }}
      </button>
    </div>
    <div class="grid gap-3 sm:grid-cols-2">
      <label
        v-for="module in visibleModules"
        :key="module.id"
        class="flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition"
        :class="
          modelValue.includes(module.id)
            ? 'border-accent bg-accent/5'
            : 'border-divider hover:bg-primaryLight'
        "
      >
        <input
          type="checkbox"
          class="mt-0.5 h-4 w-4 shrink-0 accent-accent"
          :aria-label="`选择${module.label}数据`"
          :checked="modelValue.includes(module.id)"
          :disabled="disabled"
          @change="
            toggle(module.id, ($event.target as HTMLInputElement).checked)
          "
        />
        <span class="min-w-0">
          <span class="block font-medium text-secondaryDark">{{
            module.label
          }}</span>
          <span
            class="mt-1 block text-tiny leading-relaxed text-secondaryLight"
            >{{ module.description }}</span
          >
        </span>
      </label>
    </div>
    <p v-if="!visibleModules.length" class="py-4 text-secondaryLight">
      配置包中没有可导入的数据
    </p>
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue";
import { type Entry } from "~/helpers/data-sync/model";
import { dataModules, moduleFor, type ModuleID } from "~/helpers/data-sync/modules";
const props = defineProps<{
  entries: Entry[]
  modelValue: ModuleID[]
  disabled?: boolean
  imported?: boolean
}>()
const emit = defineEmits<{
  (e: "update:modelValue", value: ModuleID[]): void
}>()
const visibleModules = computed(() =>
  props.imported
    ? dataModules.filter((module) =>
        props.entries.some((entry) => moduleFor(entry.kind) === module.id)
      )
    : dataModules
)
const allSelected = computed(
  () =>
    visibleModules.value.length > 0 &&
    visibleModules.value.every((module) => props.modelValue.includes(module.id))
)
function toggleAll() {
  emit(
    "update:modelValue",
    allSelected.value ? [] : visibleModules.value.map((module) => module.id)
  )
}
function toggle(id: ModuleID, on: boolean) {
  emit(
    "update:modelValue",
    on
      ? [...new Set([...props.modelValue, id])]
      : props.modelValue.filter((value) => value !== id)
  )
}
</script>
