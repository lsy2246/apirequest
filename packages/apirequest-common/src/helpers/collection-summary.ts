import type { HoppCollection, HoppGQLRequest, HoppRESTRequest } from "@apirequest/data"

/** Read-only navigation entries. They must never become editor documents or writes. */
export type CollectionRequestSummary = {
  __workbenchSummary: true
  __revision: string
  __hasResponses: boolean
  id: string
  _ref_id: string
  name: string
  responses: Record<string, never>
  method?: string
  endpoint?: string
  url?: string
  query?: string
}

export function isCollectionRequestSummary(value: unknown): value is CollectionRequestSummary {
  return !!value && typeof value === "object" &&
    (value as CollectionRequestSummary).__workbenchSummary === true
}

/** Missing entries cannot be treated as deleted while navigation is incomplete. */
export function hasUnloadedCollectionRequests(collections: HoppCollection[]): boolean {
  return collections.some((folder) =>
    !!(folder as HoppCollection & { __workbenchUnloaded?: boolean }).__workbenchUnloaded ||
    hasUnloadedCollectionRequests(folder.folders))
}

export function assertCollectionRequestLoaded(value: unknown): void {
  if (isCollectionRequestSummary(value))
    throw new Error("接口详情尚未加载，请重试。")
}

export function assertCollectionLoaded(collection: HoppCollection): void {
  if ((collection as HoppCollection & { __workbenchUnloaded?: boolean }).__workbenchUnloaded)
    throw new Error("集合目录尚未加载，请先展开集合。")
  ;(collection.requests ?? []).forEach(assertCollectionRequestLoaded)
  ;(collection.folders ?? []).forEach(assertCollectionLoaded)
}

/** Preserve device-only work separately from the server's navigation cache. */
export function collectPendingCollections(tree: HoppCollection[]): HoppCollection[] {
  return tree.flatMap((folder) => {
    const folders = collectPendingCollections(folder.folders)
    const requests = folder.requests.filter((request) => !request.id)
    return !folder.id || folders.length || requests.length ? [{ ...folder, folders, requests }] : []
  })
}

export function mergePendingCollections(tree: HoppCollection[], pending: HoppCollection[]): HoppCollection[] {
  const result = [...tree]
  for (const folder of pending) {
    const target = result.find((item) => folder.id ? item.id === folder.id : item._ref_id === folder._ref_id)
    if (!target) {
      if (!folder.id) result.push(folder)
      continue
    }
    target.folders = mergePendingCollections(target.folders, folder.folders)
    const refs = new Set(target.requests.map((request) => request._ref_id))
    target.requests.push(...folder.requests.filter((request) => !refs.has(request._ref_id)))
  }
  return result
}

export function summaryAsNavigationRequest(summary: CollectionRequestSummary) {
  // The legacy tree adapter has one request type. Keep the explicit summary
  // discriminant across cloning; all editor/save/export boundaries reject it.
  return summary as unknown as HoppRESTRequest | HoppGQLRequest
}
