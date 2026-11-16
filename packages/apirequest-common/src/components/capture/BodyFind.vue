<template>
  <div
    class="capture-body-find flex min-h-0 flex-col gap-2"
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <div
      class="flex flex-wrap items-center gap-1 rounded border border-divider bg-primaryLight p-2"
    >
      <input
        ref="input"
        v-model="queryText"
        type="search"
        :aria-label="t('workbench_capture.find_body')"
        :placeholder="t('workbench_capture.find_body')"
        class="min-w-0 flex-1 rounded border border-divider bg-primary px-2 py-1"
        @keydown.enter.stop.prevent="move($event.shiftKey ? -1 : 1)"
      />
      <span
        role="status"
        aria-live="polite"
        class="whitespace-nowrap px-1 text-tiny text-secondaryLight"
      >
        {{
          queryText
            ? total
              ? `${current} / ${total}`
              : t("workbench_capture.find_no_matches")
            : "0 / 0"
        }}
      </span>
      <HoppButtonSecondary
        :icon="IconUp"
        :title="t('workbench_capture.find_previous')"
        :aria-label="t('workbench_capture.find_previous')"
        :disabled="!total"
        @click="move(-1)"
      />
      <HoppButtonSecondary
        :icon="IconDown"
        :title="t('workbench_capture.find_next')"
        :aria-label="t('workbench_capture.find_next')"
        :disabled="!total"
        @click="move(1)"
      />
      <HoppButtonSecondary
        :icon="IconClose"
        :title="t('action.close')"
        :aria-label="t('action.close')"
        @click="$emit('close')"
      />
    </div>
    <p class="text-tiny text-secondaryLight">
      {{ t("workbench_capture.find_scope") }}
    </p>
    <div
      ref="editor"
      class="h-[min(28rem,55vh)] min-h-40 overflow-hidden rounded border border-divider"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Compartment, EditorState, Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { SearchQuery, findNext, findPrevious, getSearchQuery, setSearchQuery } from "@codemirror/search";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting } from "@codemirror/language";
import { basicSetup, baseTheme, baseHighlightStyle } from "~/helpers/editor/themes/baseTheme";
import { useI18n } from "~/composables/i18n";
import IconUp from "~icons/lucide/chevron-up";
import IconDown from "~icons/lucide/chevron-down";
import IconClose from "~icons/lucide/x";

const props = defineProps<{ text: string; mode: string }>()
const emit = defineEmits<{ (event: "close"): void }>()
const t = useI18n()
const input = ref<HTMLInputElement>(),
  editor = ref<HTMLElement>()
const queryText = ref(""),
  total = ref(0),
  current = ref(0)
let view: EditorView | undefined
const content = computed(() => props.text)

// 只给编辑器可见区域创建高亮，完整正文和命中计数不截断，避免大量匹配生成大量 DOM。
function matchDecorations(editorView: EditorView): DecorationSet {
  const query = getSearchQuery(editorView.state)
  if (!query.valid) return Decoration.none
  const builder = new RangeSetBuilder<Decoration>()
  const selected = editorView.state.selection.main
  for (const { from, to } of editorView.visibleRanges) {
    const cursor = query.getCursor(editorView.state, from, to)
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      const match = next.value
      builder.add(
        match.from,
        match.to,
        Decoration.mark({
          class:
            selected.from === match.from && selected.to === match.to
              ? "cm-searchMatch cm-searchMatch-selected"
              : "cm-searchMatch",
        })
      )
    }
  }
  return builder.finish()
}
const highlights = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(editorView: EditorView) {
      this.decorations = matchDecorations(editorView)
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        !getSearchQuery(update.state).eq(getSearchQuery(update.startState))
      )
        this.decorations = matchDecorations(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations }
)

function updateCount(editorView: EditorView, recount = true) {
  const query = getSearchQuery(editorView.state)
  const selected = editorView.state.selection.main
  let count = 0,
    position = 0
  if (query.valid) {
    const cursor = query.getCursor(editorView.state)
    for (let next = cursor.next(); !next.done; next = cursor.next()) {
      const match = next.value
      count++
      if (match.from === selected.from && match.to === selected.to)
        position = count
      if (!recount && match.from > selected.from) break
    }
  }
  if (recount) total.value = count
  current.value = position
}
function move(direction: number) {
  if (!view || !total.value) return
  ;(direction < 0 ? findPrevious : findNext)(view)
}
function applyQuery() {
  if (!view) return
  // 纯文本查找，关闭正则与转义解释；命中由同一查询同时驱动高亮、计数和位置跳转。
  view.dispatch({
    effects: setSearchQuery.of(
      new SearchQuery({
        search: queryText.value,
        caseSensitive: false,
        literal: true,
        regexp: false,
      })
    ),
    selection: { anchor: 0 },
  })
  if (queryText.value && total.value) findNext(view)
}
const language = new Compartment()
onMounted(() => {
  // 组合既有编辑器主题与只读能力，正文按原样载入，不经过脚本编辑器的前缀清理。
  view = new EditorView({
    parent: editor.value,
    state: EditorState.create({
      doc: props.text,
      extensions: [
        basicSetup,
        baseTheme,
        syntaxHighlighting(baseHighlightStyle, { fallback: true }),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
        language.of(props.mode === "application/json" ? json() : []),
        highlights,
        Prec.highest(
          keymap.of([
            {
              key: "Mod-f",
              run: () => {
                input.value?.focus()
                return true
              },
            },
            {
              key: "Escape",
              run: () => {
                emit("close")
                return true
              },
            },
          ])
        ),
        EditorView.theme({
          ".cm-searchMatch": { backgroundColor: "#fbbf2460" },
          ".cm-searchMatch-selected": {
            backgroundColor: "#f59e0b",
            color: "#111827",
          },
        }),
        EditorView.updateListener.of((update) => {
          const queryChanged = !getSearchQuery(update.state).eq(
            getSearchQuery(update.startState)
          )
          if (update.docChanged || queryChanged || update.selectionSet)
            updateCount(update.view, update.docChanged || queryChanged)
        }),
      ],
    }),
  })
  input.value?.focus()
})
onBeforeUnmount(() => {
  view?.destroy()
  view = undefined
})
watch(
  () => props.mode,
  (mode) =>
    view?.dispatch({
      effects: language.reconfigure(mode === "application/json" ? json() : []),
    })
)
watch(queryText, applyQuery)
watch(
  content,
  () => {
    // 归档分页或流式正文更新后重算；旧文档的命中位置不带到新内容。
    if (view)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: props.text },
      })
    applyQuery()
  },
  { flush: "post" }
)
</script>
