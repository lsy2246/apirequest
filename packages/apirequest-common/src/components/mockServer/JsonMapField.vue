<template>
  <label class="block"
    >{{ label
    }}<textarea
      v-model="text"
      rows="3"
      class="mock-field mt-1 w-full font-mono"
      @input="update"
    /><span v-if="error" role="alert" class="mt-1 block text-red-500">{{
      error
    }}</span></label
  >
</template>
<script setup lang="ts">
import { ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
const props = defineProps<{
  modelValue?: Record<string, string>
  label: string
}>()
const emit = defineEmits<{ "update:modelValue": [Record<string, string>] }>()
const text = ref(JSON.stringify(props.modelValue ?? {}, null, 2)),
  error = ref(""),
  t = useI18n()
watch(
  () => props.modelValue,
  (value) => {
    if (!error.value) text.value = JSON.stringify(value ?? {}, null, 2)
  }
)
function update(event: Event) {
  const input = event.target as HTMLTextAreaElement
  try {
    const value = JSON.parse(text.value)
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.values(value).every((v) => typeof v === "string")
    )
      throw new Error()
    error.value = ""
    input.setCustomValidity("")
    emit("update:modelValue", value)
  } catch {
    error.value = t("mock_tools.headers_error")
    input.setCustomValidity(error.value)
  }
}
</script>
