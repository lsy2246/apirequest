import axios from "axios"
import { HoppCollection, HoppGQLRequest, HoppRESTRequest, makeCollection } from "@apirequest/data"
import { reactive } from "vue"
import { platform } from "~/platform"
import { restCollectionStore, setRESTCollections } from "~/newstore/collections"
import { runDispatchWithOutSyncing } from "~/lib/sync"
import { readCollectionCache, writeCollectionCache } from "./remote-collection-cache"
import { collectPendingCollections, mergePendingCollections, isCollectionRequestSummary, summaryAsNavigationRequest } from "./collection-summary"

type Request = HoppRESTRequest | HoppGQLRequest
export type RemoteCollectionIndex = {
  schemaVersion: 1
  revision: string
  lazyRequests?: boolean
  loadedFolders?: string[]
  pageCursors?: Record<string, { orderIndex: number; id: string }>
  collections: { id: string; parentID: string | null; title: string; type: string; data: unknown; orderIndex: number; updatedOn: string }[]
  requests: { id: string; collectionID: string; title: string; refID: string | null; method: string | null; endpoint: string | null; gql: boolean; hasResponses: boolean; orderIndex: number; updatedOn: string }[]
}
type Detail = { id: string; title: string; collectionID: string; request: unknown; updatedOn: string }
type CachedDetail = { revision: string; request: Request }

const loaded = new Map<string, CachedDetail>()
const pending = new Map<string, Promise<Request>>()
const pendingFolders = new Map<string, Promise<void>>()
export const remoteFolderLoading = reactive(new Set<string>())
export const remoteFolderErrors = reactive(new Map<string, string>())
export const remoteRequestLoading = reactive(new Set<string>())
let index: RemoteCollectionIndex | undefined
let requestIndex = new Map<string, RemoteCollectionIndex["requests"][number]>()
let loadedFolderIDs = new Set<string>()
let requestPaths = new Map<string, { folderPath: number[]; requestIndex: number }>()
let refresh: Promise<void> | undefined
let generation = 0
let persistenceStarted = false
let recoveredPending: HoppCollection[] = []
let installTree: ((tree: HoppCollection[]) => void) | undefined
export function setRemoteCollectionInstaller(install: (tree: HoppCollection[]) => void) {
  installTree = install
}

const base = () => `${import.meta.env.VITE_BACKEND_API_URL}/workbench-mcp/collections`
const headers = { "X-Workbench-Local": "1" }
export const usesRemoteCollectionIndex = () =>
  !import.meta.env.VITE_WORKBENCH_NATIVE && !window.__APIREQUEST_NATIVE__ &&
  platform.auth.localSessionState?.value === "ready"

export function buildRemoteCollectionTree(snapshot: RemoteCollectionIndex, preserved = new Map<string, Request>()): HoppCollection[] {
  const folders = new Map<string, HoppCollection>()
  const included = new Set(snapshot.loadedFolders ?? [])
  for (const row of snapshot.collections) {
    const raw = typeof row.data === "string" ? JSON.parse(row.data) : row.data
    const data = (raw && typeof raw === "object" ? raw : {}) as Partial<HoppCollection>
    const folder = makeCollection({
      description: data.description ?? null,
      auth: data.auth ?? { authType: "inherit", authActive: true },
      headers: data.headers ?? [], variables: data.variables ?? [],
      preRequestScript: data.preRequestScript ?? "", testScript: data.testScript ?? "",
      id: row.id, _ref_id: data._ref_id || row.id,
      name: row.title, folders: [], requests: [],
    })
    if (snapshot.lazyRequests && !included.has(row.id))
      (folder as HoppCollection & { __workbenchUnloaded?: boolean }).__workbenchUnloaded = true
    folders.set(row.id, folder)
  }
  const roots: HoppCollection[] = []
  for (const row of snapshot.collections) {
    const folder = folders.get(row.id)!
    if (row.parentID === null) roots.push(folder)
    else folders.get(row.parentID)?.folders.push(folder)
  }
  for (const row of snapshot.requests) {
    const cached = loaded.get(row.id)
    const previous = preserved.get(row.id)
    const request = previous && !isCollectionRequestSummary(previous) && cached?.revision === row.updatedOn
      ? previous : cached?.revision === row.updatedOn ? cached.request : summaryAsNavigationRequest({
      __workbenchSummary: true, __revision: row.updatedOn, __hasResponses: row.hasResponses,
      id: row.id, _ref_id: row.refID || row.id, name: row.title, responses: {},
      ...(row.gql ? { url: row.endpoint || "", query: "" } : { method: row.method || "GET", endpoint: row.endpoint || "" }),
    })
    folders.get(row.collectionID)?.requests.push(request)
  }
  return roots
}

function install(snapshot: RemoteCollectionIndex) {
  if (snapshot.schemaVersion !== 1 || !Array.isArray(snapshot.collections) || !Array.isArray(snapshot.requests))
    throw new Error("工作区索引格式不正确")
  const preserved = new Map<string, Request>()
  const remember = (folders: HoppCollection[]) => folders.forEach((folder) => {
    folder.requests.forEach((request) => { if (request.id) preserved.set(request.id, request) })
    remember(folder.folders)
  })
  remember(restCollectionStore.value.state)
  const tree = mergePendingCollections(
    buildRemoteCollectionTree(snapshot, preserved),
    mergePendingCollections(collectPendingCollections(restCollectionStore.value.state), recoveredPending),
  )
  recoveredPending = []
  if (index?.revision !== snapshot.revision) remoteFolderErrors.clear()
  index = snapshot
  loadedFolderIDs = new Set(snapshot.loadedFolders ?? [])
  requestIndex = new Map(snapshot.requests.map((row) => [row.id, row]))
  const paths = new Map<string, { folderPath: number[]; requestIndex: number }>()
  const collectPaths = (folders: HoppCollection[], parent: number[] = []) => {
    folders.forEach((folder, folderIndex) => {
      const folderPath = [...parent, folderIndex]
      folder.requests.forEach((request, requestIndex) => {
        if (request.id) paths.set(request.id, { folderPath, requestIndex })
      })
      collectPaths(folder.folders, folderPath)
    })
  }
  collectPaths(tree)
  requestPaths = paths
  if (installTree) installTree(tree)
  else runDispatchWithOutSyncing(() => setRESTCollections(tree))
}

export async function refreshRemoteCollectionIndex(): Promise<void> {
  if (!usesRemoteCollectionIndex()) return
  refresh ??= (async () => {
    const ticket = ++generation
    const response = await axios.get<RemoteCollectionIndex>(`${base()}/index`, {
      params: { lazy: 1 },
      withCredentials: true,
      headers: { ...headers, ...(index ? { "If-None-Match": `W/"${index.revision}"` } : {}) },
      validateStatus: (status) => status === 200 || status === 304,
    })
    if (response.status === 304 || ticket !== generation || response.data.revision === index?.revision) return
    install(response.data)
    void writeCollectionCache("index", "workspace", response.data)
  })().finally(() => { refresh = undefined })
  return refresh
}

export async function initRemoteCollectionIndex() {
  if (index) { await refreshRemoteCollectionIndex(); return }
  if (!persistenceStarted) {
    persistenceStarted = true
    const saved = await readCollectionCache<HoppCollection[]>("index", "pending")
    if (Array.isArray(saved)) recoveredPending = saved.filter((folder) => {
      try { return HoppCollection.safeParse(folder).type === "ok" } catch { return false }
    })
    let timer: ReturnType<typeof setTimeout>
    restCollectionStore.subject$.subscribe(({ state }) => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        void writeCollectionCache("index", "pending", collectPendingCollections(state))
      }, 200)
    })
  }
  const cached = await readCollectionCache<RemoteCollectionIndex>("index", "workspace")
  if (cached) {
    try { install(cached) } catch { /* Rebuild an obsolete/invalid cache from the server. */ }
  }
  const update = refreshRemoteCollectionIndex()
  if (index) void update.catch((error) => console.warn("工作区索引暂时无法更新", error))
  else await update
}

export const usesLazyRemoteCollections = () => usesRemoteCollectionIndex() && index?.lazyRequests === true
export const isRemoteFolderLoaded = (id: string) =>
  !index?.lazyRequests || loadedFolderIDs.has(id)

export function retryRemoteFolder(id: string): Promise<void> {
  remoteFolderErrors.delete(id)
  return ensureRemoteFolder(id)
}

export function remoteFolderHasMore(id: string) {
  return !!index?.pageCursors?.[id]
}

/** One page for navigation; explicit export/run can request the complete folder. */
export function ensureRemoteFolder(id: string, all = false): Promise<void> {
  if (!index?.lazyRequests || isRemoteFolderLoaded(id)) return Promise.resolve()
  const running = pendingFolders.get(id)
  if (running) return all ? running.then(() => ensureRemoteFolder(id, true)) : running
  const task = (async () => {
    remoteFolderLoading.add(id)
    remoteFolderErrors.delete(id)
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (refresh) await refresh
        const current: RemoteCollectionIndex | undefined = index
        if (!current?.lazyRequests || loadedFolderIDs.has(id)) return
        const cursor = current.pageCursors?.[id]
        let result: { data: { revision: string; requests: RemoteCollectionIndex["requests"];
          nextCursor: { orderIndex: number; id: string } | null } }
        try {
          result = await axios.get(`${base()}/folders/${encodeURIComponent(id)}/requests`, {
            headers, withCredentials: true,
            params: { revision: current.revision,
              ...(cursor ? { cursorOrder: cursor.orderIndex, cursorID: cursor.id } : {}) },
          })
          if (result.data.revision !== current.revision) throw new Error("目录版本已变化")
        } catch (error) {
          if (axios.isAxiosError(error) && error.response?.status === 409) {
            await refreshRemoteCollectionIndex()
            continue
          }
          throw error
        }
        const latest = index
        if (!latest || latest.revision !== current.revision) continue
        if (latest.loadedFolders?.includes(id)) return
        // Other folders can complete while this page is in flight; merge into
        // the latest snapshot without discarding their data.
        const nextCursors = { ...latest.pageCursors }
        if (result.data.nextCursor) nextCursors[id] = result.data.nextCursor
        else delete nextCursors[id]
        const next = {
          ...latest,
          requests: [...latest.requests.filter((row) => row.collectionID !== id),
            ...(cursor ? latest.requests.filter((row) => row.collectionID === id) : []),
            ...result.data.requests],
          pageCursors: nextCursors,
          loadedFolders: result.data.nextCursor ? (latest.loadedFolders ?? [])
            : [...(latest.loadedFolders ?? []), id],
        }
        install(next)
        void writeCollectionCache("index", "workspace", next)
        return
      }
      throw new Error("目录正在更新，请重试")
    } catch (error) {
      remoteFolderErrors.set(id, error instanceof Error ? error.message : "集合目录加载失败")
      throw error
    } finally { remoteFolderLoading.delete(id) }
  })().finally(() => pendingFolders.delete(id))
  pendingFolders.set(id, task)
  return all ? task.then(() => ensureRemoteFolder(id, true)) : task
}

export async function searchRemoteRequests(text: string) {
  if (!usesLazyRemoteCollections() || !text.trim()) return [] as RemoteCollectionIndex["requests"]
  const response = await axios.get<RemoteCollectionIndex["requests"]>(`${base()}/search`, {
    headers, withCredentials: true, params: { q: text.trim() },
  })
  return response.data
}

function parseDetail(row: Detail): Request {
  const data = { ...(row.request as object), id: row.id, name: row.title }
  const gql = "query" in data && "url" in data && !("endpoint" in data)
  const parsed = gql ? HoppGQLRequest.safeParse(data) : HoppRESTRequest.safeParse(data)
  if (parsed.type !== "ok") throw new Error("接口详情格式不正确")
  return parsed.value
}

function applySingleDetail(id: string, detail: Request): boolean {
  const location = requestPaths.get(id)
  if (!location) return false
  const replace = (folders: HoppCollection[], depth: number): HoppCollection[] | undefined => {
    const folderIndex = location.folderPath[depth]
    const folder = folders[folderIndex]
    if (!folder) return undefined
    let updated: HoppCollection
    if (depth === location.folderPath.length - 1) {
      if (folder.requests[location.requestIndex]?.id !== id ||
          !isCollectionRequestSummary(folder.requests[location.requestIndex])) return undefined
      const requests = [...folder.requests]
      requests[location.requestIndex] = detail
      updated = { ...folder, requests }
    } else {
      const children = replace(folder.folders, depth + 1)
      if (!children) return undefined
      updated = { ...folder, folders: children }
    }
    const result = [...folders]
    result[folderIndex] = updated
    return result
  }
  const tree = replace(restCollectionStore.value.state, 0)
  if (!tree) return false
  runDispatchWithOutSyncing(() => setRESTCollections(tree))
  return true
}

function applyDetails(details: Map<string, Request>) {
  const replace = (folders: HoppCollection[]): HoppCollection[] => folders.map((folder) => {
    const children = replace(folder.folders)
    const requests = folder.requests.map((request) =>
      request.id && isCollectionRequestSummary(request) ? details.get(request.id) ?? request : request)
    return children.some((child, i) => child !== folder.folders[i]) || requests.some((request, i) => request !== folder.requests[i])
      ? { ...folder, folders: children, requests } : folder
  })
  runDispatchWithOutSyncing(() => setRESTCollections(replace(restCollectionStore.value.state)))
}

export function remoteRequestLocation(request: Pick<Request, "id" | "_ref_id">): { folderPath: string; requestIndex: number } | undefined {
  const visit = (folders: HoppCollection[], parent = ""): { folderPath: string; requestIndex: number } | undefined => {
    for (const [i, folder] of folders.entries()) {
      const folderPath = parent ? `${parent}/${i}` : String(i)
      const requestIndex = folder.requests.findIndex((item) =>
        request.id ? item.id === request.id : !!request._ref_id && item._ref_id === request._ref_id)
      if (requestIndex !== -1) return { folderPath, requestIndex }
      const nested = visit(folder.folders, folderPath)
      if (nested) return nested
    }
  }
  return visit(restCollectionStore.value.state)
}

/** Restore navigation by stable identity, loading only pages needed to find it. */
export async function ensureRemoteRequestLocation(
  request: Pick<Request, "id" | "_ref_id">,
  options: { folderPath?: string; canLoad?: (folderPath: string) => boolean; recoverDetached?: boolean } = {},
) {
  if (refresh) await refresh
  let location = remoteRequestLocation(request)
  if (location && options.recoverDetached) {
    const entry = request.id ? requestIndex.get(request.id) : undefined
    // Duplicated drafts retain the source database ID but get a new ref ID.
    // Never attach those drafts to the original saved request.
    if (!entry || (request._ref_id || request.id) !== (entry.refID || entry.id)) return
  }
  if (location || !usesLazyRemoteCollections()) return location
  let folderID: string | undefined
  if (request.id) {
    // The saved positional path may be stale after folders are reordered or
    // requests move. The detail endpoint supplies the authoritative folder.
    try {
      const { data } = await axios.get<Detail>(`${base()}/requests/${encodeURIComponent(request.id)}`, {
        headers, withCredentials: true,
      })
      if (options.recoverDetached && (request._ref_id || request.id) !==
        ((data.request as Partial<Request>)?._ref_id || data.id)) return
      folderID = data.collectionID
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) return
      throw error
    }
  } else if (request._ref_id && options.folderPath) {
    let folders = restCollectionStore.value.state
    for (const part of options.folderPath.split("/")) {
      const folder = folders[Number(part)]
      if (!folder) return
      folderID = folder.id
      folders = folder.folders
    }
  }
  if (!folderID) return
  const findFolderPath = (folders: HoppCollection[], parent = ""): string | undefined => {
    for (const [i, folder] of folders.entries()) {
      const path = parent ? `${parent}/${i}` : String(i)
      if (folder.id === folderID) return path
      const nested = findFolderPath(folder.folders, path)
      if (nested) return nested
    }
  }
  while (!location && !isRemoteFolderLoaded(folderID)) {
    const path = findFolderPath(restCollectionStore.value.state)
    if (!path || options.canLoad?.(path) === false) return
    await ensureRemoteFolder(folderID)
    location = remoteRequestLocation(request)
  }
  return location
}

export function ensureRemoteRequest(request: Request): Promise<Request> {
  if (!isCollectionRequestSummary(request)) return Promise.resolve(request)
  const id = request.id
  const existing = pending.get(id)
  if (existing) return existing
  const task = (async () => {
    remoteRequestLoading.add(id)
    try {
      // A cached index may be displayed immediately, but detail reads wait for
      // its in-flight validation to avoid reopening an obsolete cache version.
      if (refresh) await refresh
      const entry = requestIndex.get(id)
      if (index && !entry) throw new Error("接口已被删除，请刷新工作区")
      const revision = entry?.updatedOn ?? request.__revision
      const cached = loaded.get(id) ?? await readCollectionCache<CachedDetail>("requests", id)
      let detail: Request | undefined
      if (cached?.revision === revision && !isCollectionRequestSummary(cached.request)) {
        // Validate persistent cache entries as well as network responses.
        try {
          detail = parseDetail({ id, title: request.name, collectionID: "", request: cached.request, updatedOn: cached.revision })
          loaded.set(id, { revision: cached.revision, request: detail })
        } catch { /* Ignore a corrupt cache and obtain the authoritative detail. */ }
      }
      if (!detail) {
        const response = await axios.get<Detail>(`${base()}/requests/${encodeURIComponent(id)}`, { headers, withCredentials: true })
        if (response.data.id !== id) throw new Error("接口详情与请求不匹配")
        detail = parseDetail(response.data)
        const value = { revision: response.data.updatedOn, request: detail }
        loaded.set(id, value)
        void writeCollectionCache("requests", id, value)
      }
      if (!applySingleDetail(id, detail)) applyDetails(new Map([[id, detail]]))
      return detail
    } finally { remoteRequestLoading.delete(id) }
  })().finally(() => pending.delete(id))
  pending.set(id, task)
  return task
}

function findRemoteFolder(id: string): HoppCollection | undefined {
  const visit = (folders: HoppCollection[]): HoppCollection | undefined => {
    for (const folder of folders) {
      if (folder.id === id) return folder
      const child = visit(folder.folders)
      if (child) return child
    }
  }
  return visit(restCollectionStore.value.state)
}

export async function ensureRemoteCollection(collection: HoppCollection): Promise<HoppCollection> {
  if (usesLazyRemoteCollections()) {
    // Refreshes can add folders while earlier pages are arriving. Revisit the
    // current subtree until every folder has a complete request list.
    for (let attempt = 0; attempt < 3; attempt++) {
      const missing: string[] = []
      const visitFolders = (folder: HoppCollection) => {
        if (folder.id && !isRemoteFolderLoaded(folder.id)) missing.push(folder.id)
        folder.folders.forEach(visitFolders)
      }
      visitFolders(collection)
      if (!missing.length) break
      for (const id of missing) await ensureRemoteFolder(id, true)
      const current = collection.id ? findRemoteFolder(collection.id) : undefined
      if (current) collection = current
      if (attempt === 2) {
        const remaining: string[] = []
        const check = (folder: HoppCollection) => {
          if (folder.id && !isRemoteFolderLoaded(folder.id)) remaining.push(folder.id)
          folder.folders.forEach(check)
        }
        check(collection)
        if (remaining.length) throw new Error("集合目录持续变化，请重试")
      }
    }
  }
  const requests: Request[] = []
  const visit = (folder: HoppCollection) => {
    requests.push(...folder.requests.filter(isCollectionRequestSummary))
    folder.folders.forEach(visit)
  }
  visit(collection)
  if (!requests.length) return collection
  const ids = [...new Set(requests.map((request) => request.id!))]
  ids.forEach((id) => remoteRequestLoading.add(id))
  try {
    const rows: Detail[] = []
    for (let start = 0; start < ids.length; start += 200) {
      const response = await axios.post<Detail[]>(`${base()}/requests/batch`,
        { ids: ids.slice(start, start + 200) }, { headers, withCredentials: true })
      rows.push(...response.data)
    }
    const details = new Map(rows.map((row) => [row.id, parseDetail(row)]))
    if (details.size !== ids.length || ids.some((id) => !details.has(id))) throw new Error("集合详情未完整加载")
    for (const row of rows) {
      const value = { revision: row.updatedOn, request: details.get(row.id)! }
      loaded.set(row.id, value)
      // An explicit full export/run need not fill the browser cache with every detail.
      if (ids.length <= 128) void writeCollectionCache("requests", row.id, value)
    }
    applyDetails(details)
    const hydrate = (folder: HoppCollection): HoppCollection => ({
      ...folder, folders: folder.folders.map(hydrate),
      requests: folder.requests.map((request) => request.id && isCollectionRequestSummary(request) ? details.get(request.id)! : request),
    })
    return hydrate(collection)
  } finally { ids.forEach((id) => remoteRequestLoading.delete(id)) }
}

export async function ensureAllRemoteCollections() {
  // One batch prevents thousands of individual HTTP requests for an export.
  const root = makeCollection({
    name: "workspace", folders: restCollectionStore.value.state, requests: [],
    description: null, auth: { authType: "none", authActive: false }, headers: [],
    variables: [], preRequestScript: "", testScript: "",
  })
  if (usesLazyRemoteCollections()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const ids = index?.collections.map((row) => row.id).filter((id) => !isRemoteFolderLoaded(id)) ?? []
      if (!ids.length) break
      for (const id of ids) await ensureRemoteFolder(id, true)
      if (attempt === 2 && index?.collections.some((row) => !isRemoteFolderLoaded(row.id)))
        throw new Error("工作区目录持续变化，请重试")
    }
    root.folders = restCollectionStore.value.state
  }
  const hydrated = await ensureRemoteCollection(root)
  return hydrated.folders
}
