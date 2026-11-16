import { shallowRef, ref } from "vue"
import { readLocal, writeLocal } from "~/helpers/native-workbench-config"
import { snapshot, importEntries } from "./workspace"
import {
  defaultConnection,
  readCloud,
  writeCloud,
  type Connection,
  type Remote,
} from "./cloud"
import {
  compare,
  decodePackage,
  encodePackage,
  fingerprint,
  makePackage,
  sanitizeEntry,
  canonical,
  mergeCatalog,
  type Entry,
  type ConfigPackage,
  type SyncRow,
} from "./model"

import { normalizeModules, selectModules, type ModuleID } from "./modules"

export type State = {
  provider: "webdav" | "google"
  webdav: Connection
  google: Connection
  selected: ModuleID[]
  auto: boolean
  baseline: Record<string, Record<string, string>>
  lastSync?: string
}
const initial = (): State => ({
  provider: "webdav",
  webdav: defaultConnection("webdav"),
  google: defaultConnection("google"),
  selected: [],
  auto: false,
  baseline: {},
})
export const syncState = shallowRef<State>(initial())
export const syncBusy = ref(false),
  syncMessage = ref("")
let loading: Promise<void> | undefined
export async function loadSyncState() {
  loading ??= (async () => {
    const saved = await readLocal<Partial<State>>("workbench.data-sync.v1")
    if (saved)
      syncState.value = {
        ...initial(),
        provider: saved.provider === "google" ? "google" : "webdav",
        auto: saved.auto ?? false,
        baseline: saved.baseline ?? {},
        lastSync: saved.lastSync,
        selected: normalizeModules(saved.selected ?? []),
        webdav: { ...defaultConnection("webdav"), ...saved.webdav },
        google: { ...defaultConnection("google"), ...saved.google },
      }
  })().catch((error) => {
    loading = undefined
    throw error
  })
  return loading
}
export async function saveSyncState(state: State) {
  await writeLocal("workbench.data-sync.v1", JSON.parse(JSON.stringify(state)))
  syncState.value = JSON.parse(JSON.stringify(state))
}
export const connection = (s: State) => s[s.provider]
export const connectionKey = (s: State) =>
  canonical([
    s.provider,
    connection(s).url,
    connection(s).username,
    connection(s).fileName,
    connection(s).clientId,
    connection(s).account,
  ])
export type Preview = {
  rows: SyncRow[]
  remote: Remote
  pack: ConfigPackage
  local: Entry[]
  selected: string[]
  key: string
  options: string
}
export async function prepareSync(state: State): Promise<Preview> {
  const local = await snapshot(
      false,
      true,
      normalizeModules(state.selected).includes("capture")
    ),
    remote = await readCloud(connection(state))
  const pack =
    remote.text === null ? makePackage([]) : await decodePackage(remote.text)
  const normalized = pack.entries.map((e) => sanitizeEntry(e, false, true))
  const union = mergeCatalog(local, normalized)
  const selected = selectModules(union, state.selected).map((e) => e.id)
  const rows = await compare(
    local,
    normalized,
    selected,
    state.baseline[connectionKey(state)] ?? {}
  )
  return {
    rows,
    remote,
    pack,
    local,
    selected,
    key: connectionKey(state),
    options: canonical(normalizeModules(state.selected)),
  }
}
export async function commitSync(state: State, preview: Preview) {
  if (
    preview.key !== connectionKey(state) ||
    preview.options !== canonical(normalizeModules(state.selected))
  )
    throw new Error("同步设置已变化，请重新预览")
  const current = await snapshot(
      false,
      true,
      normalizeModules(state.selected).includes("capture")
    ),
    map = new Map(current.map((e) => [e.id, e]))
  for (const row of preview.rows)
    if ((await fingerprint(map.get(row.id))) !== (await fingerprint(row.local)))
      throw new Error("本地配置已变化，请重新预览")
  const downloads: Entry[] = [],
    remoteMap = new Map(preview.pack.entries.map((e) => [e.id, e]))
  const baseline = { ...(state.baseline[preview.key] ?? {}) }
  for (const row of preview.rows) {
    if (row.status === "same") {
      baseline[row.id] = await fingerprint(row.local)
      continue
    }
    if (!row.choice) throw new Error("请先处理全部冲突项")
    if (row.choice === "skip") continue
    if (row.choice === "both" && row.local && row.remote) {
      const copy = duplicateEntry(row.remote)
      downloads.push(copy)
      remoteMap.set(copy.id, copy)
      remoteMap.set(row.id, row.local)
      baseline[row.id] = await fingerprint(row.local)
      baseline[copy.id] = await fingerprint(copy)
      continue
    }
    const chosen = row.choice === "local" ? row.local : row.remote
    if (!chosen)
      throw new Error("删除项不会自动清除另一端，请选择保留现有配置或跳过")
    if (row.choice === "local") remoteMap.set(row.id, chosen)
    else downloads.push(chosen)
    baseline[row.id] = await fingerprint(chosen)
  }
  const raw = await snapshot(
    true,
    true,
    normalizeModules(state.selected).includes("capture")
  )
  if (downloads.length) await importEntries(downloads, raw, true)
  const entries = [...remoteMap.values()].sort((a, b) =>
    a.id.localeCompare(b.id)
  )
  if (
    canonical(entries) !==
    canonical(
      [...preview.pack.entries].sort((a, b) => a.id.localeCompare(b.id))
    )
  )
    await writeCloud(
      connection(state),
      await encodePackage(makePackage(entries)),
      preview.remote
    )
  else {
    const latest = await readCloud(connection(state))
    if (latest.text !== preview.remote.text)
      throw new Error("云端配置已变化，请重新预览")
  }
  if (downloads.length) await importEntries(downloads, raw)
  state.baseline[preview.key] = baseline
  state.lastSync = new Date().toISOString()
  await saveSyncState(state)
  syncMessage.value = `同步完成 · ${new Date().toLocaleTimeString()}`
}
let timer: ReturnType<typeof setInterval> | undefined
export function startAutoSync() {
  if (timer) return () => {}
  const run = async () => {
    if (
      syncBusy.value ||
      !syncState.value.auto ||
      document.visibilityState === "hidden"
    )
      return
    syncBusy.value = true
    try {
      const state = JSON.parse(JSON.stringify(syncState.value)) as State
      if (!state.selected.length) return
      const preview = await prepareSync(state)
      if (preview.rows.some((row) => row.status === "conflict")) {
        syncMessage.value = "发现同步冲突，请到设置 → 数据管理中处理"
        return
      }
      await commitSync(state, preview)
    } catch (error) {
      syncMessage.value =
        error instanceof Error ? error.message : "自动同步失败"
    } finally {
      syncBusy.value = false
    }
  }
  timer = setInterval(() => void run(), 60000)
  return () => {
    if (timer) clearInterval(timer)
    timer = undefined
  }
}

export function duplicateEntry(entry: Entry): Entry {
  const copy = JSON.parse(JSON.stringify(entry)) as Entry
  copy.id = `${copy.kind}:${crypto.randomUUID()}`
  copy.name = `${copy.name}（导入副本）`
  if (copy.kind === "request") {
    const request = copy.data.request as Record<string, unknown>
    request.name = copy.name
    request._ref_id = copy.id.slice(8)
    delete request.id
  } else {
    copy.data.name = copy.name
    if ("id" in copy.data) copy.data.id = copy.id.slice(copy.kind.length + 1)
  }
  return copy
}
