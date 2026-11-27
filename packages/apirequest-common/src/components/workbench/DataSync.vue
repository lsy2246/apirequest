<template>
  <section class="workbench-panel p-5 sm:p-8" data-testid="data-sync">
    <div class="mb-5">
      <h3 class="heading">数据管理</h3>
      <p class="mt-2 text-secondaryLight">
        {{
          nativeBackup
            ? "统一导入导出数据，支持工作区备份和云端同步。"
            : "按数据类型选择导入、导出或同步，所选类型包含其中的全部数据。"
        }}
      </p>
    </div>
    <div
      class="mb-5 grid grid-cols-3 gap-1 rounded-lg bg-primaryLight p-1 sm:flex"
      role="tablist"
      aria-label="数据操作"
      @keydown="navigateTabs"
    >
      <button
        v-for="item in modes"
        :key="item.value"
        type="button"
        role="tab"
        :aria-selected="mode === item.value"
        :tabindex="mode === item.value ? 0 : -1"
        :id="`${dataTabsID}-${item.value}`"
        :aria-controls="`${dataTabsID}-panel`"
        class="flex-1 rounded-md px-2 py-2 font-medium transition sm:px-4"
        :class="
          mode === item.value
            ? 'bg-primary text-accent shadow-sm'
            : 'text-secondary'
        "
        :disabled="busy"
        @click="changeMode(item.value)"
      >
        {{ item.label }}
      </button>
    </div>
    <div
      :id="`${dataTabsID}-panel`"
      role="tabpanel"
      :aria-labelledby="`${dataTabsID}-${mode}`"
    >
      <fieldset
        v-if="nativeBackup && mode !== 'sync'"
        :disabled="busy"
        class="mb-5"
      >
        <legend class="mb-2 font-medium text-secondaryDark">
          {{ mode === "export" ? "导出内容" : "导入内容" }}
        </legend>
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="transferKind"
              name="data-transfer-kind"
              type="radio"
              value="types"
              class="accent-accent"
              @change="invalidate"
            />按数据类型
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input
              v-model="transferKind"
              name="data-transfer-kind"
              type="radio"
              value="workspace"
              class="accent-accent"
              @change="invalidate"
            />工作区备份
          </label>
        </div>
      </fieldset>
      <WorkspaceBackup
        v-if="workspaceTransfer"
        :key="mode"
        :mode="mode === 'export' ? 'export' : 'restore'"
        :disabled="syncBusy || !!operation"
        @busy-change="backupBusy = $event"
      />
      <div
        v-else-if="loading"
        class="flex items-center gap-3 p-6"
        role="status"
      >
        <HoppSmartSpinner />正在读取配置…
      </div>
      <template v-else>
        <div
          v-if="mode === 'sync'"
          class="mb-5 space-y-4 rounded-lg border border-divider bg-primaryLight p-4"
        >
          <label class="block space-y-2"
            ><span class="font-medium text-secondaryDark">同步源</span
            ><WorkbenchSelect
              v-model="draft.provider"
              label="同步源"
              :options="[
                { value: 'webdav', label: 'WebDAV' },
                { value: 'google', label: 'Google Drive' },
              ]"
              :disabled="busy"
              @update:model-value="invalidateConnection"
          /></label>
          <template v-if="draft.provider === 'webdav'">
            <label class="ds-label"
              >WebDAV 目录地址<input
                v-model.trim="activeConnection.url"
                class="input"
                placeholder="https://cloud.example.com/remote.php/dav/files/user/API-Request/"
                :disabled="busy"
                @input="invalidate"
            /></label>
            <div class="grid gap-4 sm:grid-cols-2">
              <label class="ds-label"
                >用户名<input
                  v-model="activeConnection.username"
                  class="input"
                  autocomplete="off"
                  :disabled="busy"
                  @input="invalidate" /></label
              ><label class="ds-label"
                >应用密码<input
                  v-model="activeConnection.password"
                  type="password"
                  class="input"
                  autocomplete="new-password"
                  :disabled="busy"
                  @input="invalidate"
              /></label>
            </div>
            <p class="text-tiny text-secondaryLight">
              请填写已存在的目录。连接信息仅保存在本机。
            </p>
          </template>
          <template v-else>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-secondary">{{
                activeConnection.refreshToken
                  ? `已连接 · ${activeConnection.account || "Google Drive"}`
                  : "尚未连接 Google Drive"
              }}</span>
              <div class="flex flex-wrap gap-2">
                <HoppButtonSecondary
                  v-if="authorizing && authURL"
                  label="打开授权页面"
                  aria-label="打开授权页面"
                  @click="reopenAuth"
                />
                <HoppButtonSecondary
                  v-if="!authorizing"
                  :label="
                    activeConnection.refreshToken
                      ? '重新授权'
                      : '连接 Google Drive'
                  "
                  :aria-label="
                    activeConnection.refreshToken
                      ? '重新授权'
                      : '连接 Google Drive'
                  "
                  :disabled="busy"
                  outline
                  @click="authorize"
                /><HoppButtonSecondary
                  v-if="activeConnection.refreshToken && !busy"
                  label="断开连接"
                  aria-label="断开连接"
                  @click="disconnect"
                /><HoppButtonSecondary
                  v-if="authorizing"
                  label="取消授权"
                  aria-label="取消授权"
                  @click="authController?.abort()"
                />
              </div>
            </div>
            <details :open="!activeConnection.clientId">
              <summary class="cursor-pointer text-secondaryDark">
                Google OAuth 配置
              </summary>
              <div class="mt-3 space-y-3">
                <label class="ds-label"
                  >桌面应用 Client ID<input
                    v-model.trim="activeConnection.clientId"
                    class="input"
                    placeholder="…apps.googleusercontent.com"
                    :disabled="busy"
                    @input="invalidateGoogleCredentials" /></label
                ><label class="ds-label"
                  >Client secret（如凭据文件提供）<input
                    v-model="activeConnection.clientSecret"
                    type="password"
                    class="input"
                    autocomplete="new-password"
                    :disabled="busy"
                    @input="invalidateGoogleCredentials"
                /></label>
                <p class="text-tiny text-secondaryLight">
                  在 Google Cloud 启用 Drive API，创建“桌面应用”OAuth
                  客户端。授权会打开浏览器；仅请求本应用文件权限。另一台设备使用相同
                  Google 账号和 OAuth 配置。
                </p>
                <HoppButtonSecondary
                  label="查看 Google 配置说明"
                  aria-label="查看 Google 配置说明"
                  @click="openGoogleGuide"
                />
              </div>
            </details>
          </template>
          <label class="ds-label"
            >同步文件名<input
              v-model.trim="activeConnection.fileName"
              class="input"
              placeholder="apirequest-config.json"
              :disabled="busy"
              @input="invalidate"
          /></label>
          <div class="flex flex-wrap items-center gap-3">
            <HoppButtonSecondary
              label="测试连接"
              aria-label="测试连接"
              :loading="operation === 'test'"
              :disabled="busy"
              outline
              @click="test"
            /><HoppButtonSecondary
              label="保存同步设置"
              aria-label="保存同步设置"
              :disabled="busy"
              outline
              @click="save"
            /><span v-if="testMessage" class="text-secondary" role="status">{{
              testMessage
            }}</span>
          </div>
        </div>
        <div
          v-if="mode === 'import'"
          class="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-divider p-4"
        >
          <input
            ref="fileInput"
            class="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label="选择配置包"
            :disabled="busy"
            @change="readFile"
          />
          <HoppButtonSecondary
            label="选择配置包"
            aria-label="选择配置包文件"
            outline
            :disabled="busy"
            @click="fileInput?.click()"
          />
          <span v-if="fileName" class="text-secondaryLight">{{
            fileName
          }}</span>
        </div>
        <p v-if="mode === 'sync'" class="mb-3 text-secondaryLight">
          所选数据类型会被记住，之后新增的数据也会自动纳入同步。
        </p>
        <div v-if="catalogError && mode !== 'import'" class="mb-3 flex flex-wrap items-center gap-2 text-secondaryLight" role="status">
          数据数量暂不可用。{{ catalogError }}
          <HoppButtonSecondary label="重试读取数量" :disabled="catalogLoading" @click="loadCounts" />
        </div>
        <ConfigPicker
          v-if="mode !== 'import' || imported"
          v-model="selected"
          :entries="available"
          :counts="mode === 'import' ? undefined : counts"
          :imported="mode === 'import'"
          :disabled="busy"
          @update:model-value="invalidate"
        />
        <div v-if="mode === 'sync'" class="mt-4 space-y-2">
          <label class="flex items-center gap-2"
            ><input
              v-model="draft.auto"
              type="checkbox"
              :disabled="busy"
              @change="invalidate"
            />启用自动同步</label
          >
          <p class="text-tiny text-secondaryLight">
            应用打开且可见时，每分钟同步已保存的选择范围。遇到冲突会暂停，等待手动处理。删除项不会自动清除另一端。
          </p>
          <p v-if="draft.lastSync" class="text-secondaryLight">
            上次同步：{{ new Date(draft.lastSync).toLocaleString() }}
          </p>
          <p v-if="syncMessage" role="status" class="text-secondary">
            {{ syncMessage }}
          </p>
        </div>
        <p v-if="mode === 'sync'" class="mt-5 text-tiny text-secondaryLight">
          先比较本地与云端数据，确认变更后再同步。
        </p>
        <div class="mt-5 flex flex-wrap gap-3">
          <HoppButtonPrimary
            v-if="mode === 'export'"
            :label="`导出所选数据（${selected.length} 类）`"
            :aria-label="`导出所选数据（${selected.length} 类）`"
            :disabled="busy || !selected.length"
            :loading="operation === 'export'"
            @click="exportFile"
          />
          <HoppButtonPrimary
            v-else
            :label="mode === 'sync' ? '检查同步变更' : '预览导入'"
            :aria-label="mode === 'sync' ? '检查同步变更' : '预览导入'"
            :disabled="
              busy ||
              !selected.length ||
              (mode === 'import' && !selection.length)
            "
            :loading="operation === 'preview'"
            @click="preview"
          />
        </div>
        <section
          v-if="rows"
          class="mt-6 rounded-lg border border-divider"
          data-testid="transfer-preview"
        >
          <div class="border-b border-divider p-4">
            <h4 class="font-semibold text-secondaryDark">
              {{ mode === "sync" ? "待同步变更" : "导入预览" }}
            </h4>
            <p class="mt-1 text-secondaryLight">
              {{ rows.length }} 项 ·
              {{ rows.filter((r) => r.status === "conflict").length }} 项冲突
            </p>
          </div>
          <div class="divide-y divide-dividerLight">
            <div v-for="group in previewGroups" :key="group.id" class="p-4">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0">
                  <span class="font-medium text-secondaryDark">{{
                    group.label
                  }}</span>
                  <p class="mt-1 text-tiny text-secondaryLight">
                    {{ moduleSummary(group.rows) }}
                  </p>
                </div>
                <WorkbenchSelect
                  v-if="group.rows.some((row) => row.status === 'conflict')"
                  class="w-44"
                  :label="`${group.label}冲突处理`"
                  :model-value="modulePolicy(group.rows)"
                  placeholder="选择冲突处理方式"
                  :options="[
                    { value: 'local', label: '冲突时保留本地' },
                    {
                      value: 'remote',
                      label:
                        mode === 'sync'
                          ? '冲突时使用云端'
                          : '冲突时使用导入数据',
                    },
                    { value: 'skip', label: '跳过冲突数据' },
                  ]"
                  :disabled="busy"
                  @update:model-value="
                    resolveModuleConflicts(
                      group.rows,
                      $event as 'local' | 'remote' | 'skip'
                    )
                  "
                />
              </div>
            </div>
          </div>
          <div class="flex flex-wrap gap-3 border-t border-divider p-4">
            <HoppButtonPrimary
              :label="mode === 'sync' ? '确认同步' : '确认导入'"
              :aria-label="mode === 'sync' ? '确认同步' : '确认导入'"
              :disabled="busy || unresolved"
              :loading="operation === 'apply'"
              @click="apply"
            /><HoppButtonSecondary
              label="取消"
              aria-label="取消"
              :disabled="busy"
              @click="cancelPreview"
            />
          </div>
        </section>
      </template>
      <p
        v-if="operation"
        role="status"
        aria-live="polite"
        class="mt-4 text-secondary"
      >
        {{ operationText[operation] ?? "正在处理…" }}
      </p>
      <p
        v-if="error && !workspaceTransfer"
        role="alert"
        class="mt-4 rounded-md bg-red-500/10 p-3 text-red-600"
      >
        {{ error }}
      </p>
      <p v-if="message" role="status" class="mt-4 text-secondary">
        {{ message }}
      </p>
    </div>
  </section>
</template>
<script setup lang="ts">
import { navigateTabs } from "~/helpers/ui-states"
import { ref, computed, onMounted, onBeforeUnmount, watch, useId } from "vue"
import WorkbenchSelect from "./Select.vue"
import ConfigPicker from "./ConfigPicker.vue"
import WorkspaceBackup from "./WorkspaceBackup.vue"
import { snapshot, snapshotCatalogCounts, importEntries, type CatalogCounts } from "~/helpers/data-sync/workspace"
import {
  decodePackage,
  encodePackage,
  makePackage,
  mergeCatalog,
  compare,
  fingerprint,
  type Entry,
  type ConfigPackage,
  type SyncRow,
} from "~/helpers/data-sync/model"
import {
  syncState,
  syncBusy,
  syncMessage,
  loadSyncState,
  saveSyncState,
  connection,
  prepareSync,
  commitSync,
  type State,
  type Preview,
} from "~/helpers/data-sync/engine"
import {
  selectModules,
  normalizeModules,
  groupRows,
  resolveModuleConflicts,
  type ModuleID,
} from "~/helpers/data-sync/modules"
import { authorizeGoogle, testCloud } from "~/helpers/data-sync/cloud"
import { platform } from "~/platform"
import { readServiceCapacity } from "~/helpers/service-capacity"
import { workbenchSchedulesAvailable } from "~/helpers/workbench-mcp"
const dataTabsID = useId()
const fileInput = ref<HTMLInputElement>()
const nativeBackup = Boolean(import.meta.env.VITE_WORKBENCH_NATIVE)
const backupBusy = ref(false)
const modes = [
  { value: "export", label: "导出" },
  { value: "import", label: "导入" },
  { value: "sync", label: "云端同步" },
] as const
const transferKind = ref<"types" | "workspace">("types")
const mode = ref<"export" | "import" | "sync">("export"),
  draft = ref<State>(JSON.parse(JSON.stringify(syncState.value)))
const workspaceTransfer = computed(
  () =>
    nativeBackup && mode.value !== "sync" && transferKind.value === "workspace"
)
const counts = ref<CatalogCounts>({})
const catalogError = ref("")
const catalogLoading = ref(false)
const catalogRequest = new AbortController()
const local = ref<Entry[]>([]),
  imported = ref<ConfigPackage>(),
  selected = ref<ModuleID[]>([]),
  rows = ref<SyncRow[]>(),
  prepared = ref<Preview>()
const error = ref(""),
  message = ref(""),
  loading = ref(true),
  operation = ref(""),
  fileName = ref(""),
  testMessage = ref("")
const authorizing = ref(false),
  authURL = ref("")
const operationText: Record<string, string> = {
  load: "正在读取配置…",
  export: "正在生成配置包…",
  preview: "正在比较配置…",
  file: "正在读取配置包…",
  apply: "正在应用所选配置…",
  authorize: "请在浏览器中完成 Google 授权…",
  test: "正在测试连接…",
  save: "正在保存同步设置…",
  disconnect: "正在断开连接…",
}
let authController: AbortController | undefined
const busy = computed(
    () => syncBusy.value || !!operation.value || backupBusy.value
  ),
  activeConnection = computed(() => connection(draft.value))
const available = computed(() =>
  mode.value === "import"
    ? (imported.value?.entries ?? [])
    : mode.value === "sync" && prepared.value
      ? mergeCatalog(local.value, prepared.value.pack.entries)
      : local.value
)
const selection = computed(() => selectModules(available.value, selected.value))
const previewGroups = computed(() => groupRows(rows.value ?? []))
const unresolved = computed(
  () => rows.value?.some((row) => row.status !== "same" && !row.choice) ?? true
)
watch(
  syncState,
  (state) => {
    draft.value.baseline = JSON.parse(JSON.stringify(state.baseline))
    draft.value.lastSync = state.lastSync
  },
  { flush: "sync" }
)
function invalidateConnection() {
  prepared.value = undefined
  testMessage.value = ""
  invalidate()
}
function cancelPreview() {
  rows.value = undefined
  prepared.value = undefined
}
function invalidate() {
  rows.value = undefined
  error.value = ""
  message.value = ""
}
async function run(name: string, fn: () => Promise<void>) {
  if (busy.value) return
  operation.value = name
  syncBusy.value = true
  error.value = ""
  message.value = ""
  try {
    await fn()
  } catch (e) {
    error.value = e instanceof Error ? e.message : "操作失败，请重试"
  } finally {
    operation.value = ""
    syncBusy.value = false
  }
}
function changeMode(value: typeof mode.value) {
  mode.value = value
  rows.value = undefined
  prepared.value = undefined
  selected.value = value === "sync" ? [...draft.value.selected] : []
  error.value = ""
  message.value = ""
}
async function loadCounts() {
  if (catalogLoading.value) return
  catalogLoading.value = true
  catalogError.value = ""
  try {
    counts.value = await snapshotCatalogCounts(catalogRequest.signal)
  } catch (failure) {
    if (!catalogRequest.signal.aborted)
      catalogError.value = failure instanceof Error ? failure.message : "无法读取数据数量。"
  } finally {
    catalogLoading.value = false
  }
}
onMounted(async () => {
  try {
    await loadSyncState()
    draft.value = JSON.parse(JSON.stringify(syncState.value))
    void loadCounts()
  } catch (e) {
    error.value = e instanceof Error ? e.message : "无法读取配置"
  } finally {
    loading.value = false
  }
})
onBeforeUnmount(() => {
  catalogRequest.abort()
  authController?.abort()
})
function reopenAuth() {
  if (authURL.value)
    void platform.kernelIO.openExternalLink({ url: authURL.value })
}
function invalidateGoogleCredentials() {
  activeConnection.value.accessToken = undefined
  activeConnection.value.refreshToken = undefined
  activeConnection.value.expiresAt = undefined
  activeConnection.value.account = undefined
  draft.value.auto = false
  invalidateConnection()
}
function openGoogleGuide() {
  void platform.kernelIO.openExternalLink({
    url: "https://developers.google.com/identity/protocols/oauth2/native-app",
  })
}
async function authorize() {
  await run("authorize", async () => {
    authorizing.value = true
    authController = new AbortController()
    try {
      await authorizeGoogle(
        activeConnection.value,
        authController.signal,
        (url) => {
          authURL.value = url
          message.value = "请在浏览器中完成 Google 授权…"
        }
      )
      await saveSyncState({ ...draft.value, selected: selected.value })
      message.value = "Google Drive 已连接"
    } finally {
      authorizing.value = false
    }
  })
}
async function disconnect() {
  await run("disconnect", async () => {
    activeConnection.value.accessToken = undefined
    activeConnection.value.refreshToken = undefined
    activeConnection.value.expiresAt = undefined
    activeConnection.value.account = undefined
    draft.value.auto = false
    await saveSyncState(draft.value)
    message.value = "已断开连接，本机不再保留登录令牌"
  })
}
async function test() {
  await run("test", async () => {
    testMessage.value = ""
    await testCloud(activeConnection.value)
    testMessage.value = "连接成功"
  })
}
async function save() {
  await run("save", async () => {
    if (draft.value.auto && !selected.value.length)
      throw new Error("请先选择自动同步范围")
    draft.value.selected = [...selected.value]
    await saveSyncState(draft.value)
    message.value = "同步设置已保存"
  })
}
async function exportFile() {
  await run("export", async () => {
    local.value = await snapshot(
      false,
      true,
      selected.value.includes("capture"),
      selected.value
    )
    const text = await encodePackage(makePackage(selection.value))
    const result = await platform.kernelIO.saveFileWithDialog({
      data: text,
      contentType: "application/json",
      suggestedFilename: `API-Request-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "apirequest 配置包", extensions: ["json"] }],
    })
    if (result.type !== "saved" && result.type !== "unknown") return
    message.value = `已导出 ${selection.value.length} 项配置`
  })
}
async function readFile(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file) return
  await run("file", async () => {
    const capacity = workbenchSchedulesAvailable()
      ? await readServiceCapacity(catalogRequest.signal).catch(() => undefined)
      : undefined
    const limitMiB = capacity?.values.configImportMiB ?? 90
    if (file.size > limitMiB * 1024 * 1024)
      throw new Error(`配置包 ${(file.size / (1024 * 1024)).toFixed(1)} MiB，当前导入上限为 ${limitMiB} MiB。`)
    imported.value = await decodePackage(await file.text())
    fileName.value = file.name
    selected.value = normalizeModules(imported.value.entries.map((e) => e.id))
    invalidate()
  })
  input.value = ""
}
async function preview() {
  await run("preview", async () => {
    if (mode.value === "sync") {
      draft.value.selected = [...selected.value]
      prepared.value = await prepareSync(draft.value)
      local.value = prepared.value.local
      rows.value = prepared.value.rows
      message.value = rows.value.length
        ? "确认以下变化后再同步"
        : "所选数据类型暂无数据"
    } else {
      local.value = await snapshot(false, true, selected.value.includes("capture"), selected.value)
      rows.value = await compare(
        local.value,
        selection.value,
        selection.value.map((e) => e.id)
      )
      for (const row of rows.value)
        if (row.remote && row.status !== "same") row.choice = "remote"
    }
  })
}
async function apply() {
  await run("apply", async () => {
    if (!rows.value) return
    if (mode.value === "sync") {
      if (!prepared.value) throw new Error("请重新预览")
      draft.value.selected = [...selected.value]
      await commitSync(draft.value, { ...prepared.value, rows: rows.value })
      message.value = "同步完成"
    } else {
      const current = await snapshot(
          false,
          true,
          selected.value.includes("capture"),
          selected.value
        ),
        currentMap = new Map(current.map((e) => [e.id, e]))
      for (const row of rows.value)
        if (
          (await fingerprint(currentMap.get(row.id))) !==
          (await fingerprint(row.local))
        )
          throw new Error("本地配置已变化，请重新预览")
      const entries = rows.value.flatMap((r) =>
        r.choice === "remote" && r.remote ? [r.remote] : []
      )
      await importEntries(
        entries,
        await snapshot(true, true, selected.value.includes("capture"), selected.value)
      )
      message.value = `已导入 ${entries.length} 项配置`
    }
    rows.value = undefined
    prepared.value = undefined
    local.value = []
    await loadCounts()
  })
}
function modulePolicy(items: SyncRow[]) {
  const values = new Set(
    items.filter((row) => row.status === "conflict").map((row) => row.choice)
  )
  return values.size === 1 ? [...values][0] : undefined
}
function moduleSummary(items: SyncRow[]) {
  const count = (status: SyncRow["status"]) =>
    items.filter((row) => row.status === status).length
  return [
    count("upload") && `${count("upload")} 项上传`,
    count("download") &&
      `${count("download")} 项${mode.value === "sync" ? "下载" : "新增"}`,
    count("conflict") && `${count("conflict")} 项内容不同`,
    count("same") && `${count("same")} 项无变化`,
  ]
    .filter(Boolean)
    .join(" · ")
}
</script>
<style scoped>
.ds-label {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  color: var(--secondary-color);
}
.input {
  width: 100%;
  min-width: 0;
  border: 1px solid var(--divider-color);
  border-radius: 0.5rem;
  padding: 0.65rem 0.8rem;
  background: var(--primary-color);
  color: var(--secondary-dark-color);
}
input[type="checkbox"] {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent-color);
  flex-shrink: 0;
}
</style>
