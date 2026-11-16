<template>
  <div class="flex min-w-0 items-start gap-1">
    <textarea
      v-if="multiline"
      ref="input"
      v-model="value"
      :aria-label="label"
      :placeholder="placeholder"
      :rows="rows || 5"
      :disabled="disabled"
      class="case-field min-w-0 flex-1 font-mono"
      spellcheck="false"
      @select="remember"
      @click="remember"
      @keyup="remember"
    />
    <input
      v-else
      ref="input"
      v-model="value"
      :aria-label="label"
      :placeholder="placeholder"
      :disabled="disabled"
      class="case-field min-w-0 flex-1"
      @select="remember"
      @click="remember"
      @keyup="remember"
    />
    <CaseSelect
      model-value="__pick__"
      :options="options"
      :label="`${label} · ${t('request_case.insert_variable')}`"
      :placeholder="t('request_case.variable_button')"
      :disabled="disabled || !variables.length"
      class="w-20 shrink-0"
      @update:model-value="insert"
    />
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { useI18n } from "~/composables/i18n";
import type { CaseVariableChoice } from "~/helpers/request-cases/model";
import CaseSelect from "./Select.vue";
const props = defineProps<{
  label: string
  variables: CaseVariableChoice[]
  placeholder?: string
  multiline?: boolean
  rows?: number
  disabled?: boolean
}>()
const value = defineModel<string>({ required: true })
const input = ref<HTMLInputElement | HTMLTextAreaElement>()
const t = useI18n()
let selection: { start: number; end: number } | undefined
const options = computed(() =>
  props.variables.map((variable) => ({
    value: `${variable.scope}:${variable.key}`,
    label: `${variable.source} · ${variable.key}`,
  }))
)
function remember() {
  selection = {
    start: input.value?.selectionStart ?? value.value.length,
    end: input.value?.selectionEnd ?? value.value.length,
  }
}
async function insert(key: string) {
  const variable = props.variables.find(
    (variable) => `${variable.scope}:${variable.key}` === key
  )
  if (!variable) return
  const token = `<<${variable.key}>>`,
    start = selection?.start ?? value.value.length,
    end = selection?.end ?? value.value.length
  value.value = value.value.slice(0, start) + token + value.value.slice(end)
  selection = { start: start + token.length, end: start + token.length }
  await nextTick()
  input.value?.focus()
  input.value?.setSelectionRange(selection.start, selection.end)
}
</script>
