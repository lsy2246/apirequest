<template>
  <div class="flex min-w-0 flex-1 items-start gap-2">
    <select
      :value="binary ? 'binary' : 'text'"
      :aria-label="t('mock_tools.message_type')"
      class="mock-field"
      @change="changeType(($event.target as HTMLSelectElement).value)"
    >
      <option value="text">{{ t("mock_tools.text_message") }}</option>
      <option value="binary">{{ t("mock_tools.binary_message") }}</option>
    </select>
    <textarea
      :value="messageText"
      :aria-label="label"
      :placeholder="binary ? 'AAEC/w==' : ''"
      rows="2"
      class="mock-field min-w-0 flex-1 font-mono"
      @input="change(($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from "vue"
import { useI18n } from "~/composables/i18n"
import type { MockMessage } from "~/helpers/mockServer/rules"
const model = defineModel<MockMessage>({ required: true })
defineProps<{ label: string }>()
const t = useI18n(),
  binary = computed(() => typeof model.value !== "string")
const messageText = computed(() =>
  typeof model.value === "string" ? model.value : model.value.data
)
function change(value: string) {
  model.value = binary.value ? { type: "binary", data: value } : value
}
function changeType(value: string) {
  model.value = value === "binary" ? { type: "binary", data: "" } : ""
}
</script>
