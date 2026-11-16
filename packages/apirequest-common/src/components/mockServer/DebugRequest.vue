<template>
  <section class="space-y-3 rounded border border-divider p-3">
    <h3 class="font-semibold">{{ t("mock_tools.inspect") }}</h3>
    <p class="text-tiny text-secondaryLight">
      {{ t("mock_tools.inspect_hint") }}
    </p>
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-[6rem_minmax(0,1fr)_8rem]">
      <select
        v-model="method"
        :aria-label="t('request.method')"
        class="mock-field w-full"
      >
        <option v-for="value in methods" :key="value">
          {{ value }}
        </option></select
      ><input
        v-model="path"
        :aria-label="t('request.path')"
        class="mock-field w-full"
        placeholder="/users/1?name=demo"
      /><select
        v-model="protocol"
        :aria-label="t('mock_tools.test_protocol')"
        class="mock-field w-full"
      >
        <option value="http">HTTP</option>
        <option value="websocket">WebSocket</option>
      </select>
    </div>
    <WorkbenchToggle class="flex items-center gap-2" v-model="secure">{{
      t("mock_tools.test_https")
    }}</WorkbenchToggle>
    <details>
      <summary class="cursor-pointer text-secondaryLight">
        {{ t("mock_tools.request_headers") }} /
        {{ t("mock_tools.request_body") }}
      </summary>
      <label class="mt-2 block"
        >{{ t("mock_tools.request_headers")
        }}<textarea
          v-model="headers"
          rows="3"
          class="mock-field mt-1 w-full font-mono"
        /></label
      ><label class="mt-2 block"
        >{{ t("mock_tools.request_body")
        }}<textarea
          v-model="body"
          rows="3"
          class="mock-field mt-1 w-full font-mono"
        />
      </label>
    </details>
    <div class="flex flex-wrap gap-2">
      <HoppButtonSecondary
        type="button"
        outline
        :label="t('mock_tools.inspect')"
        :disabled="busy"
        @click="inspect"
      /><HoppButtonSecondary
        v-if="!rules && protocol === 'http'"
        type="button"
        :label="t('mock_tools.send')"
        :disabled="busy"
        @click="send"
      />
    </div>
    <p v-if="!rules" class="text-tiny text-secondaryLight">
      {{ t("mock_tools.send_hint") }}
    </p>
    <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
    <template v-if="result"
      ><p class="font-medium">
        {{
          result.selection?.rule.name ||
          result.selection?.rule.path ||
          (result.fallback ? t("mock_tools.forward") : t("mock_tools.no_match"))
        }}
      </p>
      <details open>
        <summary>{{ t("mock_tools.preview") }}</summary>
        <pre
          class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-primaryLight p-3 text-tiny"
          >{{
            JSON.stringify(result.selection?.step ?? result.fallback, null, 2)
          }}</pre>
      </details>
      <h4>{{ t("mock_tools.trace") }}</h4>
      <MatchTrace :trace="result.trace"
    /></template>
    <pre
      v-if="response"
      class="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-primaryLight p-3 text-tiny"
      >{{ JSON.stringify(response, null, 2) }}</pre>
  </section>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { ref } from "vue"
import { useI18n } from "~/composables/i18n"
import {
  mockRuleAPI,
  type MockRule,
  type MockTrace,
  type MockForward,
} from "~/helpers/mockServer/rules"
import MatchTrace from "./MatchTrace.vue"
const props = defineProps<{
  serverID: string
  rules?: MockRule[]
  initialPath?: string
  initialMethod?: string
}>()
const t = useI18n(),
  method = ref(
    props.initialMethod === "ANY" ? "GET" : props.initialMethod || "GET"
  ),
  path = ref(props.initialPath || "/"),
  headers = ref("{}"),
  body = ref(""),
  secure = ref(false),
  protocol = ref<"http" | "websocket">("http"),
  busy = ref(false),
  error = ref("")
const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
const result = ref<{
    selection: { rule: MockRule; step: MockRule["steps"][number] } | null
    fallback: MockForward | null
    trace: MockTrace[]
  }>(),
  response = ref<unknown>()
function request() {
  let parsed: unknown = body.value
  try {
    parsed = body.value ? JSON.parse(body.value) : null
  } catch {}
  return {
    method: method.value,
    path: path.value,
    headers: JSON.parse(headers.value),
    body: parsed,
    rawBody: body.value,
    protocol: protocol.value,
    secure: secure.value,
  }
}
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ""
  try {
    await action()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
function inspect() {
  void run(async () => {
    result.value = await mockRuleAPI(
      props.serverID ? `${props.serverID}/inspect` : "inspect",
      {
        request: request(),
        ...(props.rules ? { rules: props.rules } : {}),
      }
    )
  })
}
function send() {
  void run(async () => {
    response.value = await mockRuleAPI(`${props.serverID}/test`, {
      request: request(),
    })
  })
}
</script>
