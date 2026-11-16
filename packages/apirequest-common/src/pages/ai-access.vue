<template>
  <WorkbenchPage>
    <div class="min-w-0">
      <header class="workbench-page-header">
        <div>
          <h1 class="text-xl font-semibold text-secondaryDark">
            {{ t("workbench_mcp.title") }}
          </h1>
          <p class="mt-2 text-secondaryLight">
            {{ t("workbench_mcp.description") }}
          </p>
        </div>
      </header>
      <p
        v-if="error && loaded"
        role="alert"
        class="mb-4 rounded border border-red-300 p-3 text-red-500"
      >
        {{ error }}
      </p>
      <section
        class="mb-4 rounded-lg border border-divider bg-primary px-4 py-3"
      >
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span class="mr-auto flex items-center gap-2 text-secondaryLight">
            <span
              class="h-2 w-2 rounded-full"
              :class="enabled ? 'bg-green-500' : 'bg-dividerDark'"
              aria-hidden="true"
            />
            {{
              loading
                ? t("state.loading")
                : !loaded
                  ? t("workbench.load_failed")
                  : t(
                      enabled
                        ? "workbench_mcp.enabled"
                        : "workbench_mcp.disabled"
                    )
            }}
          </span>
          <WorkbenchToggle
            :on="approvalRequired"
            :disabled="busy || !loaded"
            @change="
              approvalRequired ? (confirmDirect = true) : setApprovalPolicy(true)
            "
          >
            {{ t("workbench_mcp.require_approval") }}
          </WorkbenchToggle>
        </div>
        <p v-if="!approvalRequired" class="mt-2 text-tiny text-secondaryLight">
          {{ t("workbench_mcp.direct_notice") }}
        </p>
        <details class="mt-3 border-t border-dividerLight pt-3">
          <summary class="cursor-pointer font-medium text-secondaryDark">
            {{ t("workbench_mcp.manage_connection") }}
          </summary>
          <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex gap-2">
              <HoppButtonPrimary
                :label="
                  t(enabled ? 'workbench_mcp.rotate' : 'workbench_mcp.enable')
                "
                :disabled="busy || !loaded"
                @click="setAccess(true)"
              />
              <HoppButtonSecondary
                v-if="enabled"
                :label="t('workbench_mcp.disable')"
                :disabled="busy"
                outline
                @click="setAccess(false)"
              />
            </div>
          </div>
          <p class="mt-4 text-tiny text-secondaryLight">
            {{ t("workbench_mcp.access_notice") }}
          </p>
          <div v-if="connectionJSON" class="mt-4">
            <div class="mb-2 flex items-center justify-between gap-3">
              <label class="flex items-center gap-3 font-semibold">
                {{ t("workbench_mcp.connection_config") }}
                <select
                  v-model="clientFormat"
                  class="rounded border border-divider bg-primary px-2 py-1 font-normal"
                >
                  <option value="codex">Codex · TOML</option>
                  <option value="json">MCP · JSON</option>
                </select>
              </label>
              <HoppButtonSecondary
                :label="t('action.copy')"
                @click="copyConfig"
              />
            </div>
            <pre
              class="overflow-auto rounded border border-divider bg-primaryLight p-4 text-tiny text-secondaryDark"
              >{{ clientConfig }}</pre>
            <p class="mt-2 text-tiny text-secondaryLight">
              {{ t("workbench_mcp.token_once") }}
            </p>
          </div>
          <details class="mt-4 border-t border-dividerLight pt-3">
            <summary class="cursor-pointer font-medium text-secondaryDark">
              {{ t("workbench_mcp.guide") }}
            </summary>
            <p class="my-3 text-secondaryLight">
              {{ t("workbench_mcp.guide_description") }}
            </p>
            <pre class="max-h-96 overflow-auto text-tiny">{{
              JSON.stringify(guide, null, 2)
            }}</pre>
          </details>
        </details>
      </section>
      <nav
        class="mb-3 flex flex-wrap gap-1 border-b border-divider"
        :aria-label="t('workbench_mcp.title')"
      >
        <button
          v-for="tab in views"
          :key="tab.id"
          type="button"
          :aria-pressed="view === tab.id"
          class="flex items-center gap-2 border-b-2 px-3 py-2 font-medium"
          :class="
            view === tab.id
              ? 'border-accent text-secondaryDark'
              : 'border-transparent text-secondaryLight hover:text-secondaryDark'
          "
          @click="view = tab.id"
        >
          {{ t(tab.label) }}
          <span
            v-if="tab.id === 'pending' && pendingProposals.length"
            class="rounded bg-primary px-2 py-0.5 text-tiny text-accent"
          >
            {{ pendingProposals.length }}
          </span>
        </button>
      </nav>
      <section
        v-if="view !== 'configs'"
        class="rounded-lg border border-divider bg-primary"
      >
        <div
          class="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <h2 class="flex items-center gap-2 font-semibold text-secondaryDark">
            {{
              t(
                view === "pending"
                  ? "workbench_mcp.pending_tab"
                  : "workbench_mcp.changes_tab"
              )
            }}
          </h2>
          <HoppButtonPrimary
            v-if="
              view === 'pending' && (pendingProposals.length || batchProgress)
            "
            :label="
              batchProgress
                ? t('workbench_mcp.approving_batch', batchProgress)
                : t('workbench_mcp.approve_all', {
                    count: pendingProposals.length,
                  })
            "
            :disabled="busy"
            :loading="!!batchProgress"
            @click="approveAll"
          />
        </div>
        <p
          v-if="view === 'pending' && batchResult"
          role="status"
          class="px-4 pb-3 text-tiny text-secondary"
        >
          {{ t("workbench_mcp.batch_result", batchResult) }}
        </p>
        <WorkbenchState
          v-if="loading"
          kind="loading"
          :title="t('state.loading')"
        />
        <WorkbenchState
          v-else-if="!loaded && error"
          kind="error"
          :title="t('workbench.load_failed')"
          :description="t('workbench.load_failed_description')"
          :detail="error"
        >
          <HoppButtonSecondary
            :label="t('action.retry')"
            outline
            @click="refresh"
          />
        </WorkbenchState>
        <WorkbenchState
          v-else-if="!visibleProposals.length"
          :title="
            t(
              view === 'pending'
                ? 'workbench_mcp.no_pending'
                : 'workbench_mcp.no_changes'
            )
          "
        />
        <div
          v-else
          tabindex="0"
          :aria-label="t('workbench_mcp.proposals')"
          class="max-h-[min(55vh,32rem)] divide-y divide-divider overflow-y-auto overscroll-contain border-t border-divider"
        >
          <details
            v-for="proposal in visibleProposals"
            :key="proposal.id"
            name="workbench-proposal"
            class="group"
            @toggle="togglePreview(proposal.id, $event)"
          >
            <summary
              class="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-primaryLight"
            >
              <IconChevronRight
                aria-hidden="true"
                class="h-4 w-4 shrink-0 text-secondaryLight transition group-open:rotate-90"
              />
              <div class="min-w-0 flex-1">
                <h3 class="font-medium text-secondaryDark">
                  {{
                    t(`workbench_mcp.operations.${proposal.change.operation}`)
                  }}
                  ·
                  {{ t(`workbench_mcp.entities.${proposal.change.entity}`) }}
                </h3>
                <p class="truncate text-tiny text-secondaryLight">
                  {{ proposal.change.reason }}
                </p>
              </div>
              <span
                class="shrink-0 rounded bg-primaryLight px-2 py-1 text-tiny"
                :class="{ 'text-accent': proposal.status === 'pending' }"
              >
                {{ t(`workbench_mcp.statuses.${proposal.status}`) }}
              </span>
              <span
                v-if="proposal.automatic"
                class="shrink-0 text-tiny text-secondaryLight"
              >
                {{ t("workbench_mcp.automatic") }}
              </span>
            </summary>
            <div
              v-if="openProposalID === proposal.id"
              class="border-t border-dividerLight px-4 py-3"
            >
              <p class="whitespace-pre-wrap break-words">
                {{ proposal.change.reason }}
              </p>
              <p class="mt-1 break-all text-tiny text-secondaryLight">
                {{ proposal.id }}
              </p>
              <p
                v-if="
                  proposal.change.entity === 'documentation' &&
                  proposal.change.operation !== 'delete'
                "
                class="mt-3 text-amber-600"
              >
                {{ t("workbench_mcp.publish_notice") }}
              </p>
              <p
                v-if="proposal.change.operation === 'delete'"
                class="mt-3 text-red-500"
              >
                {{ t("workbench_mcp.delete_notice") }}
              </p>
              <p
                v-if="proposal.changedFields?.length"
                class="mt-3 break-all text-tiny text-secondaryLight"
              >
                {{ t("workbench_mcp.changed_fields") }} ·
                {{ proposal.changedFields.join(", ") }}
              </p>
              <div class="mt-3 grid gap-3 lg:grid-cols-2">
                <div class="min-w-0">
                  <h4 class="mb-2 text-secondaryLight">
                    {{ t("workbench_mcp.before") }}
                  </h4>
                  <pre
                    class="max-h-48 overflow-auto rounded bg-primaryLight p-3 text-tiny"
                    >{{ JSON.stringify(proposal.before, null, 2) }}</pre>
                </div>
                <div class="min-w-0">
                  <h4 class="mb-2 text-secondaryLight">
                    {{ t("workbench_mcp.after") }}
                  </h4>
                  <pre
                    class="max-h-48 overflow-auto rounded bg-primaryLight p-3 text-tiny"
                    >{{ JSON.stringify(proposal.after, null, 2) }}</pre>
                </div>
              </div>
              <p v-if="proposal.error" class="mt-3 text-red-500">
                {{ proposal.error }}
              </p>
              <div
                v-if="proposal.status === 'pending'"
                class="mt-3 flex flex-wrap gap-2"
              >
                <HoppButtonPrimary
                  :label="t('workbench_mcp.approve')"
                  :disabled="busy"
                  @click="decide(proposal.id, true)"
                />
                <HoppButtonSecondary
                  :label="t('workbench_mcp.reject')"
                  :disabled="busy"
                  outline
                  @click="decide(proposal.id, false)"
                />
              </div>
            </div>
          </details>
        </div>
      </section>
      <template v-else>
        <WorkbenchSelect
          v-model="planKind"
          :label="t('workbench_mcp.saved_plans')"
          :options="
            planKinds.map((value) => ({
              value,
              label: t(`workbench_mcp.entities.${value}`),
            }))
          "
          class="mb-3 w-56 max-w-full"
        />
        <WorkbenchSavedPlans
          :key="planKind"
          :revision="planRevision"
          :kind="planKind"
          class="max-h-[min(55vh,32rem)] overflow-y-auto overscroll-contain"
          hide-heading
        />
      </template>
      <HoppSmartConfirmModal
        :show="confirmDirect"
        :title="t('workbench_mcp.direct_notice')"
        @hide-modal="confirmDirect = false"
        @resolve="setApprovalPolicy(false)"
      />
    </div>
  </WorkbenchPage>
</template>
<script setup lang="ts">
import WorkbenchToggle from "~/components/workbench/Toggle.vue"
import { provideWorkbenchLive, useWorkbenchLiveQuery } from "~/composables/workbenchLive";
import WorkbenchPage from "~/components/workbench/Page.vue";
import WorkbenchState from "~/components/workbench/State.vue";
import WorkbenchSelect from "~/components/workbench/Select.vue";
import { invoke } from "@tauri-apps/api/core";
import { computed, onBeforeUnmount, ref } from "vue";
import { useI18n } from "~/composables/i18n";
import { platform } from "~/platform";
import { copyToClipboard } from "~/helpers/utils/clipboard";
import { workbenchMcpAPI, type McpProposal } from "~/helpers/workbench-mcp";
import IconChevronRight from "~icons/lucide/chevron-right";
import WorkbenchSavedPlans from "~/components/workbench/SavedPlans.vue";
const live = provideWorkbenchLive()
const t = useI18n()
const views = [
  { id: "pending", label: "workbench_mcp.pending_tab" },
  { id: "changes", label: "workbench_mcp.changes_tab" },
  { id: "configs", label: "workbench_mcp.saved_plans" },
] as const
const planKinds = ["automation", "load_test", "websocket"] as const
const view = ref<(typeof views)[number]["id"]>("pending")
const planKind = ref<(typeof planKinds)[number]>("automation")
const approvalRequired = ref(true)
const confirmDirect = ref(false)
const enabled = ref(false),
  busy = ref(false),
  loading = ref(true),
  loaded = ref(false),
  error = ref(""),
  connectionJSON = ref("")
const proposals = ref<McpProposal[]>([]),
  guide = ref<unknown>()
const planRevision = computed(() =>
  proposals.value
    .filter((p) => p.status === "applied")
    .map((p) => p.id)
    .join(",")
)
const pendingProposals = computed(() =>
  proposals.value.filter((proposal) => proposal.status === "pending")
)
const visibleProposals = computed(() =>
  view.value === "pending"
    ? pendingProposals.value
    : proposals.value.filter((proposal) => proposal.status !== "pending")
)
const openProposalID = ref<string>()
function togglePreview(id: string, event: Event) {
  const details = event.currentTarget as HTMLDetailsElement
  if (details.open) openProposalID.value = id
  else if (openProposalID.value === id) openProposalID.value = undefined
}
const batchProgress = ref<{ done: number; total: number }>()
const batchResult = ref<{ applied: number; unconfirmed: number }>()
const controller = new AbortController()
let expiryTimer: ReturnType<typeof setTimeout> | undefined
let alive = true
let refreshSequence = 0
const refresh = async () => {
  const sequence = ++refreshSequence
  if (!loaded.value) loading.value = true
  try {
    const state = await workbenchMcpAPI<{
      enabled: boolean
      expiresAt?: number
      approvalRequired: boolean
      proposals: McpProposal[]
      guide: unknown
    }>("state", undefined, controller.signal)
    if (!alive || sequence !== refreshSequence) return
    enabled.value = state.enabled
    approvalRequired.value = state.approvalRequired !== false
    proposals.value = state.proposals
    guide.value = state.guide
    loaded.value = true
    error.value = ""
    clearTimeout(expiryTimer)
    const deadlines = [
      ...(state.enabled && state.expiresAt ? [state.expiresAt] : []),
      ...state.proposals
        .filter((entry) => entry.status === "pending")
        .map((entry) => entry.expiresAt),
    ].filter((date) => date > Date.now())
    if (deadlines.length)
      expiryTimer = setTimeout(
        () => liveQuery.invalidate(),
        Math.min(2147483647, Math.min(...deadlines) - Date.now() + 100)
      )
  } catch (e) {
    if (alive && sequence === refreshSequence)
      error.value = (e as Error).message
  } finally {
    if (sequence === refreshSequence) {
      loading.value = false
    }
  }
}
const setApprovalPolicy = async (required: boolean) => {
  if (busy.value) return
  confirmDirect.value = false
  busy.value = true
  error.value = ""
  // 忽略可能在保存期间返回的旧状态轮询。
  refreshSequence++
  try {
    const state = await workbenchMcpAPI<{ approvalRequired: boolean }>(
      "approval-policy",
      { required },
      controller.signal
    )
    if (alive) approvalRequired.value = state.approvalRequired
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const setAccess = async (value: boolean) => {
  busy.value = true
  error.value = ""
  connectionJSON.value = ""
  try {
    const result = await workbenchMcpAPI<{ mcpServers?: unknown }>(
      "access",
      { enabled: value },
      controller.signal
    )
    if (result.mcpServers)
      connectionJSON.value = JSON.stringify(
        { mcpServers: result.mcpServers },
        null,
        2
      )
    await refresh()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}
const submitDecision = async (id: string, approve: boolean) => {
  const result = await workbenchMcpAPI<McpProposal>(
    `proposals/${encodeURIComponent(id)}/decision`,
    { approve },
    controller.signal
  )
  if (alive) {
    proposals.value = proposals.value.map((proposal) =>
      proposal.id === id ? result : proposal
    )
  }
  return result
}

const decide = async (id: string, approve: boolean) => {
  if (busy.value) return
  busy.value = true
  batchResult.value = undefined
  error.value = ""
  try {
    await submitDecision(id, approve)
    await refresh()
  } catch (e) {
    await refresh()
    if (alive) error.value = (e as Error).message
  } finally {
    busy.value = false
  }
}

const approveAll = async () => {
  if (busy.value || !pendingProposals.value.length) return
  // 只批准点击时可见的待审项。按提交顺序复用单条审批，逐项校验版本。
  const queue = [...pendingProposals.value].sort(
    (a, b) => a.createdAt - b.createdAt
  )
  busy.value = true
  error.value = ""
  batchResult.value = undefined
  batchProgress.value = { done: 0, total: queue.length }
  let applied = 0

  try {
    for (const proposal of queue) {
      if (!alive) return
      try {
        const result = await submitDecision(proposal.id, true)
        if (result.status === "applied") applied++
      } catch {
        // 继续处理后面的提案。状态刷新后仍可逐条查看失败原因。
      }
      batchProgress.value.done++
    }
    if (!alive) return
    await refresh()
    if (alive)
      batchResult.value = { applied, unconfirmed: queue.length - applied }
  } finally {
    batchProgress.value = undefined
    busy.value = false
  }
}
const clientFormat = ref<"codex" | "json">("codex")
const clientConfig = computed(() => {
  if (!connectionJSON.value || clientFormat.value === "json")
    return connectionJSON.value
  const configuration = JSON.parse(connectionJSON.value).mcpServers.apirequest
  if (platform.localDesktop) {
    return [
      "[mcp_servers.apirequest]",
      `url = ${JSON.stringify(configuration.url)}`,
      `http_headers = { Authorization = ${JSON.stringify(configuration.headers.Authorization)} }`,
    ].join("\n")
  }
  const { command, args, env } = configuration
  return [
    "[mcp_servers.apirequest]",
    `command = ${JSON.stringify(command)}`,
    `args = ${JSON.stringify(args)}`,
    "",
    "[mcp_servers.apirequest.env]",
    ...Object.entries(env).map(
      ([key, value]) => `${key} = ${JSON.stringify(value)}`
    ),
  ].join("\n")
})
const copyConfig = () =>
  platform.localDesktop
    ? invoke("workbench_copy_text", { text: clientConfig.value })
    : copyToClipboard(clientConfig.value)
const liveQuery = useWorkbenchLiveQuery(["ai"], refresh, {
  context: live,
  blocked: busy,
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(expiryTimer)
  controller.abort()
  connectionJSON.value = ""
})
</script>
