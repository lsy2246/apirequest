<template>
  <fieldset class="min-w-0 space-y-3" data-testid="automation-case-selector">
    <legend class="font-semibold">{{ t("automation_cases.title") }}</legend>
    <div class="flex flex-wrap items-center gap-2">
      <label class="min-w-0 flex-1">
        <span class="sr-only">{{ t("automation_cases.search") }}</span>
        <input
          v-model="search"
          type="search"
          class="input w-full"
          :placeholder="t('automation_cases.search')"
        />
      </label>
      <label class="flex items-center gap-2 text-xs text-secondaryLight">
        <input v-model="onlySelected" type="checkbox" />{{
          t("automation_cases.only_selected")
        }}
      </label>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          :checked="allIDs.length > 0 && selected.length === allIDs.length"
          :indeterminate="
            selected.length > 0 && selected.length < allIDs.length
          "
          :disabled="!allIDs.length"
          @change="toggleIDs(allIDs)"
        />
        <span
          >{{ t("collection_runner.select_all") }} · {{ selected.length }} /
          {{ allIDs.length }}</span
        >
      </label>
      <div class="flex gap-3 text-secondaryLight">
        <button type="button" @click="expandAll">
          {{ t("automation_cases.expand_all") }}
        </button>
        <button type="button" @click="expanded = new Set()">
          {{ t("automation_cases.collapse_all") }}
        </button>
      </div>
    </div>
    <div
      class="max-h-80 overflow-auto rounded border border-divider"
      data-testid="case-tree"
    >
      <ul v-if="rows.length" class="py-1">
        <li
          v-for="row in rows"
          :key="row.node.key"
          class="flex min-w-0 items-center gap-2 pr-3 hover:bg-primaryLight"
          :style="{ paddingInlineStart: `${8 + row.depth * 18}px` }"
        >
          <button
            v-if="row.node.children.length"
            type="button"
            class="flex h-8 w-6 shrink-0 items-center justify-center text-secondaryLight"
            :aria-label="row.node.name"
            :aria-expanded="isExpanded(row.node.key)"
            @click="toggleExpanded(row.node.key)"
          >
            <IconChevronRight
              class="svg-icons transition-transform"
              :class="{ 'rotate-90': isExpanded(row.node.key) }"
            />
          </button>
          <span v-else class="w-6 shrink-0" />
          <label
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2"
            :class="{
              'cursor-default text-secondaryLight': !row.node.caseIDs.length,
            }"
          >
            <input
              type="checkbox"
              :aria-label="row.node.name"
              :data-node-key="row.node.key"
              :checked="isChecked(row.node)"
              :indeterminate="isMixed(row.node)"
              :disabled="!row.node.caseIDs.length"
              @change="toggleIDs(row.node.caseIDs)"
            />
            <IconFolder
              v-if="row.node.kind === 'folder'"
              class="svg-icons shrink-0 text-secondaryLight"
            />
            <span
              v-else-if="row.node.kind === 'request'"
              class="shrink-0 font-mono text-tiny"
              :style="{ color: getMethodLabelColor(row.node.method ?? '') }"
              >{{ row.node.method }}</span
            >
            <IconFlaskConical
              v-else
              class="svg-icons shrink-0 text-secondaryLight"
            />
            <span
              class="min-w-0 flex-1 break-words"
              :class="{ 'font-medium': row.node.kind === 'folder' }"
              >{{ row.node.name }}</span
            >
            <span
              v-if="row.node.timeoutMs"
              class="shrink-0 text-tiny text-secondaryLight"
              >{{ row.node.timeoutMs }} ms</span
            >
            <span
              v-if="row.node.kind !== 'case'"
              class="shrink-0 text-tiny text-secondaryLight"
              >{{
                row.node.caseIDs.length
                  ? `${selectedCount(row.node)} / ${row.node.caseIDs.length}`
                  : t("automation_cases.no_cases")
              }}</span
            >
          </label>
        </li>
      </ul>
      <p v-else class="p-4 text-sm text-secondaryLight">
        {{ t("automation_cases.no_matches") }}
      </p>
    </div>
    <p class="text-xs leading-relaxed text-secondaryLight">
      {{ t("automation_cases.help") }}
    </p>
    <p v-if="!selected.length" class="text-xs text-secondaryLight">
      {{ t("automation_cases.empty") }}
    </p>
  </fieldset>
</template>

<script setup lang="ts">
import { getMethodLabelColor } from "~/helpers/rest/labelColoring"
import { computed, ref, watch } from "vue"
import type { CaseMap, HoppCollection } from "@apirequest/data"
import {
  automationCaseTree,
  type AutomationCaseNode,
} from "~/helpers/request-cases/automation"
import { useI18n } from "~/composables/i18n"
import IconChevronRight from "~icons/lucide/chevron-right"
import IconFolder from "~icons/lucide/folder"
import IconFlaskConical from "~icons/lucide/flask-conical"

const props = defineProps<{
  collections: HoppCollection[]
  cases: CaseMap
  modelValue?: string[]
}>()
const emit = defineEmits<{ (e: "update:modelValue", ids: string[]): void }>()
const t = useI18n()
const search = ref("")
const onlySelected = ref(false)
const expanded = ref(new Set<string>())
const tree = computed(() => automationCaseTree(props.collections, props.cases))
const allIDs = computed(() => tree.value.flatMap((node) => node.caseIDs))
const selected = computed(() =>
  allIDs.value.filter(
    (id) => !props.modelValue || props.modelValue.includes(id)
  )
)
const selection = computed(() => new Set(selected.value))
const selectedCount = (node: AutomationCaseNode) =>
  node.caseIDs.filter((id) => selection.value.has(id)).length
const isChecked = (node: AutomationCaseNode) =>
  node.caseIDs.length > 0 && selectedCount(node) === node.caseIDs.length
const isMixed = (node: AutomationCaseNode) =>
  selectedCount(node) > 0 && !isChecked(node)
const filtering = computed(() => !!search.value.trim() || onlySelected.value)
const isExpanded = (key: string) => filtering.value || expanded.value.has(key)
function toggleExpanded(key: string) {
  const next = new Set(expanded.value)
  if (!next.delete(key)) next.add(key)
  expanded.value = next
}
function expandAll() {
  const next = new Set<string>()
  const visit = (nodes: AutomationCaseNode[]) =>
    nodes.forEach((node) => {
      if (node.children.length) next.add(node.key)
      visit(node.children)
    })
  visit(tree.value)
  expanded.value = next
}
watch(
  () => props.collections,
  () => {
    if (!expanded.value.size)
      expanded.value = new Set(tree.value.map((node) => node.key))
  },
  { immediate: true }
)
const rows = computed(() => {
  const result: { node: AutomationCaseNode; depth: number }[] = []
  const query = search.value.trim().toLocaleLowerCase()
  const matches = (
    node: AutomationCaseNode,
    ancestorMatch = false
  ): boolean => {
    if (
      onlySelected.value &&
      !node.caseIDs.some((id) => selection.value.has(id))
    )
      return false
    return (
      !query ||
      ancestorMatch ||
      node.name.toLocaleLowerCase().includes(query) ||
      node.children.some((child) => matches(child))
    )
  }
  const visit = (
    nodes: AutomationCaseNode[],
    depth: number,
    ancestorMatch = false
  ) => {
    for (const node of nodes) {
      if (!matches(node, ancestorMatch)) continue
      result.push({ node, depth })
      if (isExpanded(node.key))
        visit(
          node.children,
          depth + 1,
          ancestorMatch ||
            (!!query && node.name.toLocaleLowerCase().includes(query))
        )
    }
  }
  visit(tree.value, 0)
  return result
})
function toggleIDs(ids: string[]) {
  const next = new Set(selected.value)
  const remove = ids.length > 0 && ids.every((id) => next.has(id))
  ids.forEach((id) => (remove ? next.delete(id) : next.add(id)))
  emit("update:modelValue", [...next])
}
</script>
