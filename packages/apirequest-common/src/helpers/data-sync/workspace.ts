import {
  mockRuleAPI,
  type RuleServer,
  type MockRuleState,
} from "~/helpers/mockServer/rules"
import { cloneDeep } from "lodash-es"
import {
  Environment,
  HoppCollection,
  HoppRESTRequest,
  HoppGQLRequest,
} from "@apirequest/data"
import { restCollectionStore, setRESTCollections } from "~/newstore/collections"
import {
  environmentsStore,
  replaceEnvironments,
  setGlobalEnvID,
  getGlobalVariables,
  getGlobalVariableID,
  setGlobalEnvVariables,
} from "~/newstore/environments"
import {
  settingsStore,
  getDefaultSettings,
  bulkApplySettings,
  type SettingsDef,
} from "~/newstore/settings"
import {
  populateLocalStoresFromVariables,
  stripClientLocalValuesForWire,
} from "~/helpers/clientLocalVariables"
import { getService } from "~/modules/dioc"
import { SecretEnvironmentService } from "~/services/secret-environment.service"
import { CurrentValueService } from "~/services/current-environment-value.service"
import { useWorkbenchRequestCases } from "~/composables/workbenchRequestCases"
import { workbenchMcpAPI } from "~/helpers/workbench-mcp"
import {
  readLocal,
  writeLocal,
  configurations,
  validatePortablePlan,
} from "~/helpers/native-workbench-config"
import { platform } from "~/platform"
import { invoke } from "@tauri-apps/api/core"
import { SETTINGS_SCHEMA } from "~/services/persistence/validation-schemas"
import { CaseSchema } from "~/helpers/request-cases/model"
import { type Entry, restoreOmitted, sanitizeEntry } from "./model"

import { snapshotCapture, importCapture } from "./capture"

const native = () =>
  Boolean(platform.localDesktop || import.meta.env.VITE_WORKBENCH_NATIVE)
const ref = (value: { _ref_id?: string; id?: string }) =>
  value._ref_id || value.id
const cid = (id: string) => `collection:${id}`
const eid = (id: string) => `environment:${id}`
const rid = (id: string) => `request:${id}`
export const kindLabels: Record<Entry["kind"], string> = {
  collection: "接口集合",
  request: "接口与用例",
  environment: "环境变量",
  mock: "Mock 配置",
  automation: "自动化配置",
  load_test: "压测配置",
  websocket: "WebSocket 配置",
  preference: "应用偏好",
  capture: "抓包",
}

function hydrate(id: string, vars: any[]) {
  const secrets = getService(SecretEnvironmentService),
    current = getService(CurrentValueService)
  return vars.map((v, i) => {
    const s = v.secret
      ? secrets.getSecretEnvironmentVariableValue(id, i)
      : undefined
    return {
      ...v,
      initialValue: s?.initialValue ?? v.initialValue ?? "",
      currentValue: v.secret
        ? (s?.value ?? v.currentValue ?? "")
        : (current.getEnvironmentVariableValue(id, i) ?? v.currentValue ?? ""),
    }
  })
}
export async function snapshot(
  sensitive = false,
  attachments = true,
  includeCapture = false
): Promise<Entry[]> {
  const entries: Entry[] = [],
    aliases = new Map<string, string>()
  const cases = useWorkbenchRequestCases()
  await cases.ready
  const visit = (tree: HoppCollection[], parent?: string) => {
    for (const folder of tree) {
      const id = ref(folder)
      if (!id) throw new Error("集合缺少稳定 ID，请先重新打开工作区")
      const key = cid(id)
      if (folder.id) aliases.set(folder.id, key)
      aliases.set(id, key)
      const {
        folders,
        requests,
        id: _id,
        _ref_id: _ref,
        ...meta
      } = cloneDeep(folder)
      entries.push({
        id: key,
        kind: "collection",
        name: folder.name,
        parent,
        dependencies: parent ? [parent] : [],
        data: {
          ...meta,
          _ref_id: id,
          variables: hydrate(id, meta.variables ?? []),
        },
        omitted: [],
      })
      for (const request of requests) {
        const id = ref(request)
        if (!id) throw new Error("接口缺少稳定 ID，请先保存接口")
        const key = rid(id)
        if (request.id) aliases.set(request.id, key)
        aliases.set(id, key)
        const { id: serverID, ...value } = request
        const savedCases = cloneDeep(
          cases.cases.value[id] ??
            (serverID ? cases.cases.value[serverID] : undefined) ??
            []
        )
        entries.push({
          id: key,
          kind: "request",
          name: request.name,
          parent: cid(ref(folder)!),
          dependencies: [cid(ref(folder)!)],
          data: { request: { ...value, _ref_id: id }, cases: savedCases },
          omitted: [],
        })
      }
      visit(folders, key)
    }
  }
  visit(restCollectionStore.value.state)
  for (const environment of environmentsStore.value.environments) {
    const key = eid(environment.id)
    aliases.set(environment.id, key)
    entries.push({
      id: key,
      kind: "environment",
      name: environment.name,
      dependencies: [],
      data: {
        ...cloneDeep(environment),
        variables: hydrate(environment.id, environment.variables),
      },
      omitted: [],
    })
  }
  const globalID = getGlobalVariableID()
  entries.push({
    id: eid("global"),
    kind: "environment",
    name: "Global",
    dependencies: [],
    data: {
      name: "Global",
      global: true,
      variables: hydrate(globalID ?? "", getGlobalVariables()),
    },
    omitted: [],
  })
  const extras: Entry[] = native()
    ? await nativeExtras()
    : await workbenchMcpAPI("data/extras")
  for (const entry of extras) {
    for (const field of ["collectionID", "requestID", "environmentID"]) {
      const id = entry.data[field]
      if (typeof id === "string" && aliases.has(id)) {
        entry.data[field] = aliases.get(id)
        entry.dependencies.push(aliases.get(id)!)
      }
    }
    entries.push(entry)
  }
  for (const entry of entries.filter((e) => e.kind === "request")) {
    for (const testCase of entry.data.cases as { environmentID?: string }[]) {
      const target =
        testCase.environmentID && aliases.get(testCase.environmentID)
      if (target && !entry.dependencies.includes(target))
        entry.dependencies.push(target)
    }
  }
  const preferenceNames: Record<string, string> = {
    WRAP_LINES: "编辑器自动换行",
    URL_EXCLUDES: "分享链接的隐藏字段",
    THEME_COLOR: "强调色",
    BG_COLOR: "背景主题",
    EXPAND_NAVIGATION: "导航展开状态",
    SIDEBAR: "集合侧栏显示",
    SIDEBAR_ON_LEFT: "侧栏位置",
    COLUMN_LAYOUT: "请求与响应布局",
    WORKBENCH_NAVIGATION: "导航入口和顺序",
    ENABLE_AI_EXPERIMENTS: "AI 功能开关",
    AI_REQUEST_NAMING_STYLE: "AI 接口命名风格",
    CUSTOM_NAMING_STYLE: "自定义命名规则",
    ENABLE_EXPERIMENTAL_MOCK_SERVERS: "Mock 管理开关",
    ENABLE_EXPERIMENTAL_DOCUMENTATION: "文档管理开关",
    ENABLE_GQL_IN_REST_WORKSPACE: "GraphQL 入口",
  }
  const defaults = getDefaultSettings()
  for (const key of Object.keys(defaults)) {
    if (/^(sync|TELEMETRY|HAS_OPENED_SPOTLIGHT|ENCODE_MODE)/.test(key)) continue
    entries.push({
      id: `preference:${key}`,
      kind: "preference",
      name: preferenceNames[key] ?? key,
      dependencies: [],
      data: { value: cloneDeep((settingsStore.value as any)[key]) },
      omitted: [],
    })
  }
  if (includeCapture) entries.push(...(await snapshotCapture()))
  return entries.map((e) => sanitizeEntry(e, sensitive, attachments))
}

async function nativeExtras(): Promise<Entry[]> {
  const entries: Entry[] = []
  for (const kind of ["automation", "load_test", "websocket"] as const) {
    for (const { id, data } of await configurations(kind)) {
      const {
        revision: _revision,
        createdOn: _created,
        updatedOn: _updated,
        serverUrlDomainBased: _url,
        serverUrlPathBased: _path,
        accessKey: _access,
        localAccessKey: _local,
        ...value
      } = data
      entries.push({
        id: `${kind}:${id}`,
        kind,
        name: String(data.name ?? id),
        dependencies: [],
        data: value,
        omitted: [],
      })
    }
  }
  for (const server of await mockRuleAPI<RuleServer[]>()) {
    const state = await mockRuleAPI<MockRuleState>(server.id)
    entries.push({
      id: `mock:${server.id}`,
      kind: "mock",
      name: server.name,
      dependencies: [],
      data: {
        name: server.name,
        kind: server.kind,
        isActive: server.isActive,
        rules: state.rules,
        options: state.options ?? {},
      },
      omitted: [],
    })
  }
  return entries
}

/** Validate the whole batch before changing stores; selected omissions retain local secrets. */
export async function importEntries(
  incoming: Entry[],
  local: Entry[],
  dryRun = false,
  persistedIDs?: Record<string, string>
): Promise<void> {
  const localMap = new Map(local.map((e) => [e.id, e])),
    items = incoming.map((e) => restoreOmitted(e, localMap.get(e.id)))
  const tree = cloneDeep(restCollectionStore.value.state),
    environments = cloneDeep(environmentsStore.value.environments)
  const folders = new Map<string, HoppCollection>(),
    requests = new Map<string, { folder: HoppCollection; index: number }>()
  const index = (nodes: HoppCollection[]) => {
    for (const f of nodes) {
      folders.set(cid(ref(f)!), f)
      f.requests.forEach((r, i) =>
        requests.set(rid(ref(r)!), { folder: f, index: i })
      )
      index(f.folders)
    }
  }
  index(tree)
  const pending = items.filter((e) => e.kind === "collection")
  while (pending.length) {
    const i = pending.findIndex((e) => !e.parent || folders.has(e.parent))
    if (i < 0) throw new Error("缺少上级集合，请一起选择关联配置")
    const entry = pending.splice(i, 1)[0],
      existing = folders.get(entry.id)
    if (existing && entry.parent !== localMap.get(entry.id)?.parent)
      throw new Error("集合位置发生变化，请先手动调整集合位置")
    const value = {
      ...entry.data,
      name: entry.name,
      _ref_id: entry.id.slice(11),
      folders: existing?.folders ?? [],
      requests: existing?.requests ?? [],
    }
    const parsed = HoppCollection.safeParse(value)
    if (parsed.type !== "ok") throw new Error(`集合配置无效：${entry.name}`)
    const f = parsed.value
    if (existing) {
      Object.assign(existing, f)
      folders.set(entry.id, existing)
    } else {
      ;(entry.parent ? folders.get(entry.parent)!.folders : tree).push(f)
      folders.set(entry.id, f)
    }
  }
  for (const entry of items.filter((e) => e.kind === "request")) {
    const folder = entry.parent && folders.get(entry.parent)
    if (!folder) throw new Error(`接口缺少所属集合：${entry.name}`)
    const parsed = (
      entry.data.request &&
      typeof entry.data.request === "object" &&
      "url" in entry.data.request
        ? HoppGQLRequest
        : HoppRESTRequest
    ).safeParse(entry.data.request)
    if (parsed.type !== "ok") throw new Error(`接口配置无效：${entry.name}`)
    const request = parsed.value
    request._ref_id = entry.id.slice(8)
    request.name = entry.name
    CaseSchema.array().parse(entry.data.cases ?? [])
    const current = requests.get(entry.id)
    if (current && current.folder !== folder)
      throw new Error("接口位置发生变化，请先手动调整接口位置")
    if (current) folder.requests[current.index] = request
    else folder.requests.push(request)
  }
  const envItems = items.filter((e) => e.kind === "environment")
  for (const entry of envItems) {
    const parsed = Environment.safeParse({
      v: 2,
      id:
        entry.id === eid("global")
          ? (getGlobalVariableID() ?? "global")
          : entry.id.slice(12),
      name: entry.data.name,
      variables: entry.data.variables,
    })
    if (parsed.type !== "ok") throw new Error(`环境配置无效：${entry.name}`)
  }
  const extras = items.filter((e) =>
    ["mock", "automation", "load_test", "websocket"].includes(e.kind)
  )
  if (native())
    for (const entry of extras) {
      if (entry.kind === "mock") {
        if (entry.data.collectionID)
          throw new Error("基于接口示例的 Mock 已移除")
        if (!Array.isArray(entry.data.rules))
          throw new Error("Mock 缺少响应规则")
        if (
          !["single", "collection"].includes(
            String(entry.data.kind ?? "collection")
          )
        )
          throw new Error("Mock 类型无效")
      } else
        validatePortablePlan(
          entry.kind as "automation" | "load_test" | "websocket",
          entry.data
        )
    }
  const preferences: Record<string, unknown> = {}
  for (const entry of items.filter((e) => e.kind === "preference")) {
    const key = entry.id.slice(11)
    if (Object.hasOwn(getDefaultSettings(), key))
      preferences[key] = entry.data.value
  }
  const validPreferences = SETTINGS_SCHEMA.partial().safeParse(preferences)
  if (!validPreferences.success) throw new Error("应用偏好配置无效")
  const namingStyle = validPreferences.data.AI_REQUEST_NAMING_STYLE
  if (
    namingStyle !== undefined &&
    ![
      "DESCRIPTIVE_WITH_SPACES",
      "camelCase",
      "snake_case",
      "PascalCase",
      "CUSTOM",
    ].includes(namingStyle)
  )
    throw new Error("AI 命名风格配置无效")
  const captures = items.filter((entry) => entry.kind === "capture")
  await importCapture(captures, true)
  // 先校验服务端配置；失败时不会提前覆盖本地集合/环境。
  const mapped: Record<string, string> = persistedIDs ?? {}
  if (!native() && !persistedIDs) {
    const result = await workbenchMcpAPI<{ ids: Record<string, string> }>(
      "data/workspace/import",
      {
        entries: items.filter(
          (e) => !["preference", "capture"].includes(e.kind)
        ),
        dryRun,
      }
    )
    if (dryRun) return
    // 订阅可能在服务端提交期间更新其他配置，基于最新状态合并，避免回写旧的整棵树。
    return importEntries(
      incoming,
      await snapshot(true, true, captures.length > 0),
      false,
      result.ids
    )
  }
  if (!native()) {
    for (const [id, folder] of folders) if (mapped[id]) folder.id = mapped[id]
    for (const folder of folders.values())
      for (const request of folder.requests)
        if (mapped[rid(ref(request)!)]) request.id = mapped[rid(ref(request)!)]
  }
  if (dryRun) return
  await importCapture(captures, false)
  if (items.some((e) => e.kind === "collection" || e.kind === "request")) {
    for (const entry of items.filter((e) => e.kind === "collection")) {
      const folder = folders.get(entry.id)!
      populateLocalStoresFromVariables(ref(folder)!, folder.variables ?? [])
      folder.variables = stripClientLocalValuesForWire(folder.variables ?? [])
    }
    setRESTCollections(tree)
  }
  for (const entry of envItems) {
    const id =
        mapped[entry.id] ??
        (entry.id === eid("global")
          ? (getGlobalVariableID() ?? "global")
          : entry.id.slice(12)),
      variables = entry.data.variables as Environment["variables"]
    populateLocalStoresFromVariables(id, variables)
    if (entry.id === eid("global")) {
      setGlobalEnvID(id)
      setGlobalEnvVariables({
        v: 2,
        variables: stripClientLocalValuesForWire(variables),
      })
    } else {
      const index = environments.findIndex((e) => e.id === id),
        value = {
          v: 2 as const,
          id,
          name: String(entry.data.name),
          variables: stripClientLocalValuesForWire(variables),
        }
      if (index < 0) environments.push(value)
      else environments[index] = value
    }
  }
  if (envItems.some((e) => e.id !== eid("global")))
    replaceEnvironments(environments)
  const cases = useWorkbenchRequestCases()
  await cases.ready
  for (const entry of items.filter((e) => e.kind === "request"))
    await cases.update(entry.id.slice(8), () =>
      cloneDeep((entry.data.cases as any[]) ?? [])
    )
  if (Object.keys(preferences).length)
    bulkApplySettings({
      ...validPreferences.data,
      AI_REQUEST_NAMING_STYLE: (namingStyle ??
        settingsStore.value
          .AI_REQUEST_NAMING_STYLE) as SettingsDef["AI_REQUEST_NAMING_STYLE"],
      URL_EXCLUDES: {
        ...settingsStore.value.URL_EXCLUDES,
        ...validPreferences.data.URL_EXCLUDES,
        oauth2Token:
          validPreferences.data.URL_EXCLUDES?.oauth2Token ??
          settingsStore.value.URL_EXCLUDES.oauth2Token,
      },
    })
  if (extras.length && native()) await importNativeExtras(extras, folders)
}
async function importNativeExtras(
  entries: Entry[],
  folders: Map<string, HoppCollection>
) {
  for (const entry of entries) {
    const id = entry.id.slice(entry.kind.length + 1),
      data: Record<string, any> = { ...entry.data, id }
    for (const field of [
      "collectionID",
      "requestID",
      "environmentID",
    ] as const) {
      if (
        typeof data[field] === "string" &&
        /^(collection|request|environment):/.test(data[field])
      ) {
        const key = data[field]
        data[field] = key.startsWith("collection:")
          ? (folders.get(key)?.id ?? key.slice(11))
          : key.slice(key.indexOf(":") + 1)
      }
    }
    if (entry.kind === "mock") {
      const existing = (await mockRuleAPI<RuleServer[]>()).find(
        (server) => server.id === id
      )
      if (existing) {
        const current = await mockRuleAPI<MockRuleState>(id)
        await mockRuleAPI(id, {
          revision: current.revision,
          rules: data.rules,
          options: data.options ?? {},
        })
        await mockRuleAPI(`${id}/status`, { isActive: data.isActive === true })
      } else {
        await mockRuleAPI("", {
          name: data.name ?? entry.name,
          kind: data.kind ?? "collection",
          rules: data.rules,
          options: data.options ?? {},
          isActive: data.isActive === true,
        })
      }
    } else {
      const key = `workbench-native-config.${entry.kind}`,
        list = (await readLocal<any[]>(key)) ?? []
      await writeLocal(key, [...list.filter((e) => e.id !== id), data])
    }
  }
}
