<template>
  <HoppSmartModal
    dialog
    :styles="mode === 'logs' ? 'sm:max-w-3xl' : 'sm:max-w-lg'"
    :title="
      server.name +
      ' · ' +
      t(mode === 'logs' ? 'mock_tools.logs' : 'mock_tools.settings')
    "
    @close="$emit('close')"
  >
    <template #body>
      <div class="mock-form min-w-0 space-y-4">
        <p v-if="error" role="alert" class="text-red-500">{{ error }}</p>
        <p v-if="notice" role="status" class="text-green-600">{{ notice }}</p>
        <form
          v-if="mode === 'settings' && state"
          class="space-y-4"
          @submit.prevent="saveOptions"
        >
          <WorkbenchToggle class="flex items-center gap-2" v-model="fallback">{{
            t("mock_tools.fallback")
          }}</WorkbenchToggle>
          <ForwardFields v-if="fallback" v-model="forward" />
          <WorkbenchToggle class="flex items-center gap-2" v-model="recording">{{
            t("mock_tools.recording")
          }}</WorkbenchToggle>
          <p class="text-tiny text-secondaryLight">
            {{ t("mock_tools.recording_hint") }}
          </p>
          <HoppButtonPrimary
            :label="t('action.save')"
            type="submit"
            :disabled="busy"
          />
          <details>
            <summary>{{ t("mock_tools.states") }}</summary>
            <pre class="mt-2 whitespace-pre-wrap text-tiny">{{
              JSON.stringify(state.states ?? {}, null, 2)
            }}</pre>
          </details>
          <HoppButtonSecondary
            :label="t('mock_tools.reset_states')"
            :disabled="busy"
            @click="reset"
          />
        </form>
        <details v-if="mode === 'settings'" class="space-y-3">
          <summary class="cursor-pointer font-semibold">
            {{ t("mock_tools.inspect") }}
          </summary>
          <DebugRequest :server-i-d="server.id" :initial-path="initialPath" />
        </details>
        <section v-if="mode === 'logs'" class="space-y-3">
          <template v-if="!detail">
            <div class="flex flex-wrap items-center gap-2">
              <input
                v-model="search"
                type="search"
                :aria-label="t('action.search')"
                :placeholder="t('action.search')"
                class="mock-field min-w-0 flex-1"
              /><HoppButtonSecondary
                :label="t('workbench_mcp.refresh')"
                :disabled="busy"
                @click="loadLogs(false)"
              /><HoppButtonSecondary
                :label="t('mock_tools.clear_logs')"
                :disabled="busy"
                @click="clearConfirm = true"
              />
            </div>
            <div
              v-if="clearConfirm"
              class="space-y-2 rounded border border-red-300 p-3"
            >
              <p>{{ t("mock_tools.clear_confirm") }}</p>
              <HoppButtonSecondary
                :label="t('action.confirm')"
                :disabled="busy"
                @click="clearLogs"
              /><HoppButtonSecondary
                :label="t('action.cancel')"
                @click="clearConfirm = false"
              />
            </div>
            <p
              v-if="!filtered.length"
              class="p-4 text-center text-secondaryLight"
            >
              {{ t("mock_server.no_logs") }}
            </p>
            <article
              v-for="log in filtered"
              :key="log.id"
              class="rounded border border-divider p-3 text-tiny"
            >
              <button
                type="button"
                class="w-full text-left"
                @click="openLog(log.id)"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span
                    :class="
                      log.responseStatus >= 400
                        ? 'text-red-500'
                        : 'text-green-600'
                    "
                    >{{ log.responseStatus }}</span
                  >
                  <strong>{{ log.requestMethod }}</strong>
                  <code class="break-all">{{ log.requestPath }}</code
                  ><span class="ml-auto">{{ log.responseTime }} ms</span>
                </div>
                <p class="mt-1 text-secondaryLight">
                  {{ new Date(log.executedAt).toLocaleString() }} ·
                  {{
                    log.mockMatch?.name ||
                    t(
                      log.mockMatch?.upstream
                        ? "mock_tools.forward"
                        : "mock_tools.no_match"
                    )
                  }}<span v-if="log.mockMatch?.recorded">
                    · {{ t("mock_tools.recorded") }}</span
                  >
                </p>
              </button>
            </article>
            <HoppButtonSecondary
              v-if="hasMore"
              :label="t('mock_tools.load_more')"
              :disabled="busy"
              @click="loadLogs(true)"
            />
          </template>
          <section v-if="detail" class="mock-log-detail min-w-0 space-y-4">
            <header class="min-w-0 space-y-3">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <HoppButtonSecondary
                  :label="t('mock_tools.back_logs')"
                  @click="closeDetail"
                />
                <div class="flex items-center gap-3 text-tiny">
                  <span
                    class="rounded bg-primaryLight px-2 py-1 font-semibold"
                    :class="
                      detail.responseStatus >= 400
                        ? 'text-red-500'
                        : 'text-green-600'
                    "
                    >{{ detail.responseStatus }}</span
                  >
                  <span class="text-secondaryLight"
                    >{{ detail.responseTime }} ms</span
                  >
                </div>
              </div>
              <h3 class="log-request-line">
                <span
                  class="shrink-0 rounded bg-primaryLight px-2 py-1 text-tiny font-semibold"
                  >{{ detail.requestMethod }}</span
                >
                <code class="min-w-0 flex-1">{{ detail.requestPath }}</code>
              </h3>
              <p class="text-tiny text-secondaryLight">
                {{ new Date(detail.executedAt).toLocaleString() }}
              </p>
            </header>
            <p
              v-if="detail.mockMatch?.upstream"
              class="break-all text-tiny text-secondaryLight"
            >
              {{ t("mock_tools.forward") }} · {{ detail.mockMatch.upstream }}
            </p>
            <div class="flex flex-wrap gap-2">
              <HoppButtonSecondary
                v-if="detail.responseStatus !== 101"
                :label="t('mock_tools.replay')"
                :disabled="busy"
                @click="replay"
              /><HoppButtonSecondary
                v-if="
                  detail.responseStatus >= 200 &&
                  detail.responseBody !== null &&
                  detail.responseBody !== undefined
                "
                :label="t('mock_tools.save_rule')"
                :disabled="
                  busy ||
                  !!detail.mockMatch?.bodyTruncated ||
                  !!detail.mockMatch?.requestTruncated
                "
                @click="capture"
              />
            </div>
            <p class="text-tiny text-secondaryLight">
              {{ t("mock_tools.send_hint") }}
            </p>
            <p
              v-if="
                detail.mockMatch?.bodyTruncated ||
                detail.mockMatch?.requestTruncated
              "
              class="text-tiny text-amber-600"
            >
              {{ t("mock_tools.incomplete") }}
            </p>
            <details open class="log-panel">
              <summary>{{ t("mock_tools.request_details") }}</summary>
              <div class="log-panel-content">
                <LogPayload
                  :label="t('mock_tools.request_headers')"
                  :value="detail.requestHeaders"
                />
                <LogPayload
                  v-if="Object.keys(detail.requestQuery ?? {}).length"
                  :label="t('mock_tools.query_params')"
                  :value="detail.requestQuery"
                />
                <LogPayload
                  :label="t('mock_tools.request_body')"
                  :value="detail.requestBody"
                />
              </div>
            </details>
            <details open class="log-panel">
              <summary>{{ t("mock_tools.response") }}</summary>
              <div class="log-panel-content">
                <LogPayload
                  :label="t('response.headers')"
                  :value="detail.responseHeaders"
                />
                <LogPayload
                  :label="t('response.body')"
                  :value="detail.responseBody ?? t('mock_tools.no_recording')"
                />
              </div>
            </details>
            <details v-if="detail.mockMatch?.trace" open class="log-panel">
              <summary>{{ t("mock_tools.trace") }}</summary>
              <MatchTrace class="mt-3" :trace="detail.mockMatch.trace" />
            </details>
            <details v-if="replayed" open class="log-panel">
              <summary>
                {{ t("mock_tools.replay") }} · {{ t("mock_tools.response") }}
              </summary>
              <LogPayload class="mt-3" :value="replayed" />
            </details>
          </section>
        </section>
      </div>
    </template>
  </HoppSmartModal>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { computed, onMounted, ref } from "vue"
import { useI18n } from "~/composables/i18n"
import {
  mockRuleAPI,
  defaultForward,
  type RuleServer,
  type MockRuleState,
  type MockRuleLog,
  type MockLogDetail,
  type MockRule,
} from "~/helpers/mockServer/rules"
import DebugRequest from "./DebugRequest.vue"
import ForwardFields from "./ForwardFields.vue"
import MatchTrace from "./MatchTrace.vue"
import LogPayload from "./LogPayload.vue"
const props = defineProps<{
  server: RuleServer
  initialPath?: string
  mode: "logs" | "settings"
}>()
const emit = defineEmits<{
  close: []
  changed: []
  capture: [server: RuleServer, rule: MockRule]
}>()
const t = useI18n(),
  busy = ref(false),
  error = ref(""),
  notice = ref(""),
  state = ref<MockRuleState>(),
  fallback = ref(false),
  recording = ref(false),
  forward = ref(defaultForward()),
  logs = ref<MockRuleLog[]>([]),
  hasMore = ref(false),
  search = ref(""),
  detail = ref<MockLogDetail>(),
  replayed = ref<unknown>(),
  clearConfirm = ref(false)
const filtered = computed(() =>
  logs.value.filter((v) =>
    (v.requestMethod + " " + v.requestPath + " " + (v.mockMatch?.name || ""))
      .toLowerCase()
      .includes(search.value.toLowerCase())
  )
)
async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ""
  notice.value = ""
  try {
    await action()
  } catch (e) {
    error.value = String(e)
  } finally {
    busy.value = false
  }
}
async function fetchState() {
  state.value = await mockRuleAPI(props.server.id)
  fallback.value = !!state.value?.options?.fallback
  forward.value = state.value?.options?.fallback ?? defaultForward()
  recording.value = state.value?.options?.recording === true
}
onMounted(() => {
  void run(() => (props.mode === "logs" ? fetchLogs(false) : fetchState()))
})
async function fetchLogs(append: boolean) {
  const page = await mockRuleAPI<MockRuleLog[]>(
    `${props.server.id}/logs?skip=${append ? logs.value.length : 0}`
  )
  hasMore.value = page.length === 100
  logs.value = append ? [...logs.value, ...page] : page
}
function loadLogs(append: boolean) {
  void run(() => fetchLogs(append))
}
function closeDetail() {
  detail.value = undefined
  replayed.value = undefined
}
function openLog(id: string) {
  void run(async () => {
    detail.value = await mockRuleAPI(`${props.server.id}/logs/${id}`)
    replayed.value = undefined
  })
}
function replay() {
  const entry = detail.value
  if (entry)
    void run(async () => {
      replayed.value = await mockRuleAPI(
        `${props.server.id}/logs/${entry.id}/replay`,
        {}
      )
      await fetchLogs(false)
      emit("changed")
    })
}
function capture() {
  const entry = detail.value
  if (entry)
    void run(async () => {
      const rule = await mockRuleAPI<MockRule>(
        `${props.server.id}/logs/${entry.id}/capture`,
        {}
      )
      emit("capture", props.server, rule)
    })
}
function clearLogs() {
  void run(async () => {
    await mockRuleAPI(`${props.server.id}/logs/clear`, {})
    logs.value = []
    detail.value = undefined
    hasMore.value = false
    clearConfirm.value = false
  })
}
function saveOptions() {
  void run(async () => {
    const current = await mockRuleAPI<MockRuleState>(props.server.id)
    await mockRuleAPI(props.server.id, {
      revision: current.revision,
      rules: current.rules,
      options: {
        recording: recording.value,
        ...(fallback.value ? { fallback: forward.value } : {}),
      },
    })
    await fetchState()
    notice.value = t("mock_tools.saved")
    emit("changed")
  })
}
function reset() {
  void run(async () => {
    await mockRuleAPI(`${props.server.id}/reset`, {})
    await fetchState()
    emit("changed")
  })
}
</script>
<style scoped>
.log-request-line {
  @apply flex min-w-0 items-start gap-2;
}
.log-request-line code {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  user-select: text;
}
.log-panel {
  @apply min-w-0 rounded-lg border border-divider p-3;
}
.log-panel > summary {
  @apply flex cursor-pointer items-center gap-2 font-medium text-secondaryDark;
  overflow-wrap: anywhere;
}
.log-panel > summary::before {
  content: "";
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
}
.log-panel[open] > summary::before {
  transform: rotate(45deg);
}
.log-panel-content {
  @apply mt-3 min-w-0 space-y-4;
}
</style>
