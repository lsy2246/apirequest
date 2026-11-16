<template>
  <div class="space-y-3">
    <label class="block"
      >{{ t("mock_tools.upstream")
      }}<input
        v-model="model.url"
        type="url"
        required
        class="mock-field mt-1 w-full"
        placeholder="http://127.0.0.1:8080"
    /></label>
    <details>
      <summary class="cursor-pointer text-secondaryLight">
        {{ t("mock_tools.advanced") }}
      </summary>
      <div class="mt-3 space-y-3">
        <label class="block"
          >{{ t("mock_tools.rewrite_path")
          }}<input
            v-model="model.path"
            class="mock-field mt-1 w-full"
            placeholder="/api/users/{{path.id}}"
        /></label>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label
            >{{ t("request.method")
            }}<select v-model="model.method" class="mock-field mt-1 w-full">
              <option value="">{{ t("mock_tools.blank_method") }}</option>
              <option v-for="method in methods" :key="method">
                {{ method }}
              </option>
            </select></label
          >
          <label
            >{{ t("mock_tools.timeout")
            }}<input
              v-model.number="model.timeoutMs"
              type="number"
              min="100"
              max="120000"
              required
              class="mock-field mt-1 w-full"
          /></label>
        </div>
        <WorkbenchToggle
          class="flex items-center gap-2"
          v-model="model.preserveQuery"
          >{{ t("mock_tools.preserve_query") }}</WorkbenchToggle
        >
        <label class="block"
          >{{ t("mock_tools.forward_headers")
          }}<textarea
            v-model="headersText"
            rows="3"
            class="mock-field mt-1 w-full font-mono"
            @input="updateHeaders"
          />
        </label>
        <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
        <label class="block"
          >{{ t("mock_tools.remove_headers")
          }}<input
            :value="model.removeHeaders.join(', ')"
            class="mock-field mt-1 w-full"
            @input="
              model.removeHeaders = ($event.target as HTMLInputElement).value
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            "
        /></label>
      </div>
    </details>
  </div>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { ref, watch } from "vue"
import { useI18n } from "~/composables/i18n"
import type { MockForward } from "~/helpers/mockServer/rules"
const model = defineModel<MockForward>({ required: true })
const t = useI18n(),
  error = ref("")
const headersText = ref(JSON.stringify(model.value.headers, null, 2))
watch(
  () => model.value,
  () => {
    headersText.value = JSON.stringify(model.value.headers, null, 2)
  }
)
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
function updateHeaders(event: Event) {
  try {
    const value = JSON.parse((event.target as HTMLTextAreaElement).value)
    if (
      !value ||
      Array.isArray(value) ||
      typeof value !== "object" ||
      Object.values(value).some((v) => typeof v !== "string")
    )
      throw new Error("Expected an object of string header values")
    model.value.headers = value
    error.value = ""
    ;(event.target as HTMLTextAreaElement).setCustomValidity("")
  } catch (e) {
    error.value = (e as Error).message
    ;(event.target as HTMLTextAreaElement).setCustomValidity(error.value)
  }
}
</script>
