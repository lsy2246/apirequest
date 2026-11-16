import { type Entry, type SyncRow } from "./model";

export const dataModules = [
  {
    id: "interfaces",
    label: "接口",
    description: "接口集合、用例、压测与 WebSocket 配置",
    kinds: ["collection", "request", "load_test", "websocket"],
  },
  {
    id: "capture",
    label: "抓包",
    description: "已结束的抓包会话、请求记录与规则",
    kinds: ["capture"],
  },
  {
    id: "environments",
    label: "环境",
    description: "环境与全局变量",
    kinds: ["environment"],
  },
  {
    id: "automation",
    label: "自动化测试",
    description: "测试计划与定时设置",
    kinds: ["automation"],
  },
  {
    id: "mock",
    label: "Mock 服务",
    description: "Mock 配置、匹配规则与响应",
    kinds: ["mock"],
  },
  {
    id: "settings",
    label: "应用设置",
    description: "主题、导航与编辑器偏好",
    kinds: ["preference"],
  },
] as const
export type ModuleID = (typeof dataModules)[number]["id"]
export function moduleFor(kind: Entry["kind"]): ModuleID {
  return dataModules.find((module) =>
    (module.kinds as readonly string[]).includes(kind)
  )!.id
}
/** Old per-entry selections migrate once to whole modules. New records stay in scope. */
export function normalizeModules(selected: readonly string[]): ModuleID[] {
  return dataModules
    .filter((module) =>
      selected.some(
        (id) =>
          id === module.id ||
          (module.kinds as readonly string[]).includes(id.split(":")[0])
      )
    )
    .map((module) => module.id)
}
/** Never copy data from an unchecked module through an implicit dependency. */
export function selectModules(
  entries: Entry[],
  selected: readonly string[]
): Entry[] {
  const scope = new Set(normalizeModules(selected))
  return entries.filter((entry) => scope.has(moduleFor(entry.kind)))
}
export function groupRows(rows: SyncRow[]) {
  return dataModules.flatMap((module) => {
    const items = rows.filter(
      (row) => moduleFor((row.local ?? row.remote)!.kind) === module.id
    )
    return items.length ? [{ ...module, rows: items }] : []
  })
}
/** A module policy resolves conflicts only; ordinary uploads/downloads retain their direction. */
export function resolveModuleConflicts(
  rows: SyncRow[],
  policy: "local" | "remote" | "skip"
) {
  for (const row of rows.filter((item) => item.status === "conflict"))
    row.choice = policy === "skip" || !row[policy] ? "skip" : policy
}
