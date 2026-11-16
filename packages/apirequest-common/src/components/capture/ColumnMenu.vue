<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <button
        class="flex min-w-0 items-center gap-1 rounded px-1 py-1 text-left hover:bg-primaryDark focus-visible:outline focus-visible:outline-accent"
        :class="{ 'text-accent': active }"
        :aria-label="
          t(
            `workbench_capture.column_${column === 'sequence' ? 'sort' : column === 'method' ? 'filter' : 'filter_sort'}`,
            { column: label }
          )
        "
        :title="label"
      >
        <span class="truncate">{{ label }}</span>
        <span
          v-if="sorted"
          :aria-label="t('workbench_capture.sort_direction')"
          >{{ descending ? "↓" : "↑" }}</span
        >
        <span
          v-if="active"
          class="h-1 w-1 shrink-0 rounded-full bg-accent"
          :aria-label="t('workbench_capture.filter_active')"
        ></span>
        <IconChevron class="shrink-0 text-secondaryLight" />
      </button>
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        align="start"
        :side-offset="5"
        :collision-padding="12"
        class="capture-column-menu z-50 w-64 max-w-[calc(100vw-24px)] overflow-y-auto rounded border border-divider bg-primary p-3 text-xs text-secondary shadow-lg"
        :aria-label="t('workbench_capture.column_settings', { column: label })"
        @keydown.esc.stop.prevent="open = false"
      >
        <p class="mb-2 font-semibold text-secondaryDark">{{ label }}</p>
        <div v-if="column !== 'method'" class="mb-2 grid grid-cols-2 gap-1">
          <button
            v-for="direction in [false, true]"
            :key="String(direction)"
            class="rounded border border-divider px-2 py-1.5 hover:bg-primaryLight focus-visible:outline focus-visible:outline-accent"
            :class="{
              'border-accent text-accent': sorted && descending === direction,
            }"
            :aria-pressed="sorted && descending === direction"
            @click="setSort(direction)"
          >
            {{ direction ? "↓ " : "↑ "
            }}{{
              t(
                direction
                  ? "workbench_capture.sort_desc"
                  : "workbench_capture.sort_asc"
              )
            }}
          </button>
          <button
            v-if="sorted && column !== 'sequence'"
            class="col-span-2 py-1 text-secondaryLight hover:text-accent"
            @click="setSort(null)"
          >
            {{ t("workbench_capture.sort_reset") }}
          </button>
        </div>
        <form
          v-if="column !== 'sequence'"
          class="space-y-3 border-t border-divider pt-3"
          @submit.prevent="apply"
        >
          <template v-if="choices">
            <input
              v-if="column === 'application'"
              v-model="choiceSearch"
              :aria-label="t('workbench_capture.search_application')"
              :placeholder="t('workbench_capture.search_application')"
              class="w-full rounded border border-divider bg-primaryLight px-2 py-1.5"
            />
            <div
              class="max-h-48 overflow-y-auto"
              :class="
                ['status', 'method'].includes(column)
                  ? 'grid grid-cols-2 gap-x-2'
                  : 'space-y-1'
              "
            >
              <label
                v-for="choice in shownChoices"
                :key="choice.value"
                class="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-primaryLight"
              >
                <input
                  v-model="selected"
                  type="checkbox"
                  :value="choice.value"
                />
                <span class="min-w-0 truncate" :title="choice.label">{{
                  choice.label
                }}</span>
              </label>
              <p v-if="!shownChoices.length" class="py-2 text-secondaryLight">
                {{ t("workbench_capture.filter_empty") }}
              </p>
            </div>
            <label v-if="column === 'status'" class="block space-y-1">
              <span>{{ t("workbench_capture.filter_status_code") }}</span>
              <input
                v-model="exactStatus"
                inputmode="numeric"
                :placeholder="t('workbench_capture.filter_status_example')"
                class="w-full rounded border border-divider bg-primaryLight px-2 py-1.5"
              />
            </label>
            <p class="text-secondaryLight">
              {{ t("workbench_capture.filter_multiple") }}
            </p>
          </template>
          <template v-else-if="numeric">
            <p class="text-secondaryLight">
              {{
                t("workbench_capture.filter_range", {
                  unit: column === "elapsedMs" ? "ms" : "KiB",
                })
              }}
            </p>
            <div class="flex items-center gap-2">
              <input
                v-model="minimum"
                type="number"
                min="0"
                step="any"
                :aria-label="t('workbench_capture.filter_min')"
                :placeholder="t('workbench_capture.filter_min')"
                class="min-w-0 flex-1 rounded border border-divider bg-primaryLight px-2 py-1.5"
              />
              <span>—</span>
              <input
                v-model="maximum"
                type="number"
                min="0"
                step="any"
                :aria-label="t('workbench_capture.filter_max')"
                :placeholder="t('workbench_capture.filter_max')"
                class="min-w-0 flex-1 rounded border border-divider bg-primaryLight px-2 py-1.5"
              />
            </div>
            <p class="text-secondaryLight">
              {{ t("workbench_capture.filter_bounds") }}
            </p>
          </template>
          <label v-else class="block space-y-2">
            <span>{{ t("workbench_capture.filter_contains") }}</span>
            <input
              v-model="text"
              :aria-label="
                t('workbench_capture.column_contains', { column: label })
              "
              :placeholder="t('workbench_capture.filter_keyword')"
              class="w-full rounded border border-divider bg-primaryLight px-2 py-1.5"
            />
          </label>
          <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
          <div
            class="sticky bottom-0 flex items-center justify-between gap-2 bg-primary pt-2"
          >
            <button
              type="button"
              class="rounded px-2 py-1.5 text-secondaryLight hover:bg-primaryLight"
              @click="clear"
            >
              {{ t("workbench_capture.filter_clear_column") }}
            </button>
            <button
              type="submit"
              class="rounded bg-accent px-3 py-1.5 text-accentContrast"
            >
              {{ t("workbench_capture.filter_apply") }}
            </button>
          </div>
        </form>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
} from "reka-ui"
import IconChevron from "~icons/lucide/chevron-down"
import type { CaptureColumnFilter } from "~/helpers/workbench-capture"

const t = useI18n()
const props = defineProps<{
  column: string
  label: string
  value?: CaptureColumnFilter
  options?: string[]
  sorted: boolean
  descending: boolean
}>()
const emit = defineEmits<{
  (event: "filter", value: CaptureColumnFilter | undefined): void
  (event: "sort", descending: boolean | null): void
}>()
const open = ref(false),
  text = ref(""),
  selected = ref<string[]>([]),
  minimum = ref<number | string>(""),
  maximum = ref<number | string>(""),
  choiceSearch = ref(""),
  exactStatus = ref(""),
  error = ref("")
const numeric = computed(() =>
  ["elapsedMs", "responseSize"].includes(props.column)
)
const scale = computed(() => (props.column === "responseSize" ? 1024 : 1))
const active = computed(() =>
  Array.isArray(props.value)
    ? !!props.value.length
    : typeof props.value === "string"
      ? !!props.value
      : !!props.value &&
        (props.value.min !== undefined || props.value.max !== undefined)
)
const choices = computed(() => {
  if (props.column === "status")
    return [
      ...[1, 2, 3, 4, 5].map((code) => ({
        value: `${code}xx`,
        label: `${code}xx`,
      })),
      { value: "failed", label: t("workbench_capture.filter_failed") },
      { value: "pending", label: t("workbench_capture.filter_pending") },
    ]
  if (["application", "method"].includes(props.column))
    return [
      ...new Set([
        ...(props.column === "method"
          ? [
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
              "CONNECT",
              "TRACE",
            ]
          : []),
        ...(props.options ?? []),
        ...selected.value,
      ]),
    ]
      .sort()
      .map((value) => ({ value, label: value }))
  return undefined
})
const shownChoices = computed(
  () =>
    choices.value?.filter((choice) =>
      choice.label.toLowerCase().includes(choiceSearch.value.toLowerCase())
    ) ?? []
)
watch(open, (value) => {
  if (!value) return
  error.value = ""
  choiceSearch.value = ""
  text.value = typeof props.value === "string" ? props.value : ""
  selected.value = Array.isArray(props.value) ? [...props.value] : []
  exactStatus.value =
    props.column === "status"
      ? selected.value.filter((value) => /^\d{3}$/.test(value)).join(", ")
      : ""
  const range =
    props.value &&
    typeof props.value === "object" &&
    !Array.isArray(props.value)
      ? props.value
      : {}
  minimum.value = range.min === undefined ? "" : range.min / scale.value
  maximum.value = range.max === undefined ? "" : range.max / scale.value
})
function setSort(value: boolean | null) {
  emit("sort", value)
  open.value = false
}
function clear() {
  emit("filter", undefined)
  open.value = false
}
function apply() {
  error.value = ""
  if (numeric.value) {
    const min =
      minimum.value === "" ? undefined : Number(minimum.value) * scale.value
    const max =
      maximum.value === "" ? undefined : Number(maximum.value) * scale.value
    if (
      [min, max].some(
        (value) => value !== undefined && (!Number.isFinite(value) || value < 0)
      ) ||
      (min !== undefined && max !== undefined && min > max)
    ) {
      error.value = t("workbench_capture.filter_invalid_range")
      return
    }
    emit(
      "filter",
      min === undefined && max === undefined ? undefined : { min, max }
    )
  } else if (choices.value) {
    let values = [...selected.value]
    if (props.column === "status") {
      const codes = exactStatus.value.split(/[,，\s]+/).filter(Boolean)
      if (codes.some((value) => !/^[1-5]\d{2}$/.test(value))) {
        error.value = t("workbench_capture.filter_invalid_status")
        return
      }
      values = [...values.filter((value) => !/^\d{3}$/.test(value)), ...codes]
    }
    emit("filter", values.length ? [...new Set(values)] : undefined)
  } else emit("filter", text.value.trim() || undefined)
  open.value = false
}
</script>

<style>
/* PopoverContent is portalled; its final element does not carry Vue's scope attribute. */
.capture-column-menu {
  max-height: min(
    32rem,
    var(--reka-popover-content-available-height, 75vh),
    calc(100dvh - 24px)
  );
}
</style>
