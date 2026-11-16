<template><div ref="element" class="min-h-64 overflow-auto" /></template>
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { basicSetup, baseTheme } from "~/helpers/editor/themes/baseTheme";
const props = defineProps<{ before: string; after: string }>()
const element = ref<HTMLElement>()
let merge: MergeView | undefined
function render() {
  merge?.destroy()
  if (element.value)
    merge = new MergeView({
      parent: element.value,
      a: {
        doc: props.before,
        extensions: [basicSetup, baseTheme, EditorState.readOnly.of(true)],
      },
      b: {
        doc: props.after,
        extensions: [basicSetup, baseTheme, EditorState.readOnly.of(true)],
      },
      highlightChanges: true,
      gutter: true,
    })
}
onMounted(render)
watch(() => [props.before, props.after], render)
onBeforeUnmount(() => merge?.destroy())
</script>
