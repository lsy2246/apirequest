<template>
  <div class="space-y-3">
    <p class="text-tiny text-secondaryLight">
      {{ t("mock_tools.callback_hint") }}
    </p>
    <label class="block"
      >{{ t("mock_tools.callback_url")
      }}<input
        v-model="model.url"
        type="url"
        required
        class="mock-field mt-1 w-full"
        placeholder="http://127.0.0.1:8080/mock-callback"
    /></label>
    <label class="block"
      >{{ t("mock_tools.timeout")
      }}<input
        v-model.number="model.timeoutMs"
        type="number"
        min="100"
        max="120000"
        required
        class="mock-field mt-1 w-full"
    /></label>
    <label class="block"
      >{{ t("mock_tools.request_headers")
      }}<textarea
        v-model="headers"
        rows="3"
        class="mock-field mt-1 w-full font-mono"
        @input="update"
      />
    </label>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
  </div>
</template>
<script setup lang="ts">
import { ref } from "vue"
import { useI18n } from "~/composables/i18n"
const model = defineModel<{
  url: string
  headers: Record<string, string>
  timeoutMs: number
}>({ required: true })
const t = useI18n(),
  headers = ref(JSON.stringify(model.value.headers, null, 2)),
  error = ref("")
function update(event: Event) {
  const input = event.target as HTMLTextAreaElement
  try {
    const value = JSON.parse(headers.value)
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Object.values(value).every((v) => typeof v === "string")
    )
      throw new Error(t("mock_tools.headers_error"))
    model.value.headers = value
    error.value = ""
    input.setCustomValidity("")
  } catch {
    error.value = t("mock_tools.headers_error")
    input.setCustomValidity(error.value)
  }
}
</script>
