import axios from "axios";
import { indexSyncedRequests } from "~/helpers/local-workspace/collections";
import { cloneDeep } from "lodash-es";
import { nextTick } from "vue";
import { getService } from "~/modules/dioc";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
import { translateToPersonalCollectionFormat } from "./import";
import { CollectionsPlatformDef } from "~/platform/collections";
import { exportUserCollectionsToJSON, runUserChildCollectionSortedSubscription, runUserCollectionCreatedSubscription, runUserCollectionDuplicatedSubscription, runUserCollectionMovedSubscription, runUserCollectionOrderUpdatedSubscription, runUserCollectionRemovedSubscription, runUserCollectionUpdatedSubscription, runUserRequestCreatedSubscription, runUserRequestDeletedSubscription, runUserRequestMovedSubscription, runUserRequestUpdatedSubscription, runUserRootCollectionsSortedSubscription } from "./api";
import { collectionsSyncer, getStoreByCollectionType } from "./sync";
import { generateUniqueRefId, GQLHeader, HoppCollection, HoppGQLRequest, HoppRESTHeaders, HoppRESTParam, HoppRESTRequest, isGQLRequest, makeCollection } from "@apirequest/data";
import * as E from "fp-ts/Either";
import { runGQLSubscription } from "~/helpers/backend/GQLClient";
import { ReqType, UserCollectionDuplicatedData, UserRequest } from "~/helpers/backend/graphql";
import { addRESTCollection, addRESTFolder, cascadeParentCollectionForProperties, editRESTCollection, editRESTFolder, editRESTRequest, restCollectionStore, isRootRequestCollection, moveRESTFolder, moveRESTRequest, navigateToFolderWithIndexPath, removeRESTCollection, removeRESTFolder, removeRESTRequest, saveRESTRequestAs, setRESTCollections, sortRESTCollection, sortRESTFolder, updateRESTCollectionOrder, updateRESTRequestOrder } from "~/newstore/collections";
import { platform } from "~/platform";
import { runDispatchWithOutSyncing } from "..";
import { importToPersonalWorkspace } from "./import";
import { isCollectionRequestSummary } from "~/helpers/collection-summary";
function initCollectionsSync() {
  const authEvents$ = platform.auth.getAuthEventsStream()
  const currentUser$ = platform.auth.getCurrentUserStream()
  collectionsSyncer.startStoreSync()
  collectionsSyncer.setupSubscriptions(setupSubscriptions)
  const isLocal = platform.auth.localSessionState?.value === "ready"
  let initialLoad: Promise<void> | undefined
  let subscribed = false
  function restartSubscriptions() {
    collectionsSyncer.startListeningToSubscriptions()
    subscribed = true
  }
  currentUser$.subscribe((user) => {
    if (!user) return
    const load = Promise.all([loadUserCollections("REST")])
      .then(() => undefined)
      .catch((error) => {
        console.error("Failed to load workspace collections", error)
      })
    if (isLocal) initialLoad ??= load
  })
  authEvents$.subscribe((event) => {
    if (event.event === "login" || event.event === "token_refresh") {
      restartSubscriptions()
    }
  })
  // 本机会话在注册同步监听之前已经建立，首屏也需要订阅后续改动。
  return initialLoad?.then(restartSubscriptions)
}
export type ExportedUserCollectionREST = {
  id?: string
  _ref_id?: string
  folders: ExportedUserCollectionREST[]
  requests: Array<
    HoppRESTRequest & {
      id: string
    }
  >
  name: string
  data: string
}
export type ExportedUserCollectionGQL = {
  id?: string
  _ref_id?: string
  folders: ExportedUserCollectionGQL[]
  requests: Array<
    HoppGQLRequest & {
      id: string
    }
  >
  name: string
  data: string
}
function addDescriptionField(
  candidate?: HoppRESTHeaders | GQLHeader[] | HoppRESTParam[] | null
) {
  return (candidate ?? []).map((item) => ({
    ...item,
    description: "description" in item ? item.description : "",
  }))
}
// Unified collections can hold cross-type requests, so try both schemas before rebuilding.
function normalizeCollectionRequest(
  request: HoppRESTRequest | HoppGQLRequest,
  _collectionType: "REST" | "GQL"
): HoppRESTRequest | HoppGQLRequest {
  const result = isGQLRequest(request)
    ? HoppGQLRequest.safeParse(request)
    : HoppRESTRequest.safeParse(request)
  if (result.type !== "ok")
    throw new Error("Invalid current collection request")
  return result.value
}
export function exportedCollectionToHoppCollection(
  collection: ExportedUserCollectionREST | ExportedUserCollectionGQL,
  collectionType: "REST" | "GQL"
): HoppCollection {
  if (collectionType == "REST") {
    const restCollection = collection as ExportedUserCollectionREST
    const data = restCollection.data
      ? (JSON.parse(restCollection.data) ?? {})
      : {}
    return makeCollection({
      id: restCollection.id,
      _ref_id: data._ref_id ?? generateUniqueRefId("coll"),
      name: restCollection.name,
      folders: restCollection.folders.map((folder) =>
        exportedCollectionToHoppCollection(folder, collectionType)
      ),
      requests: restCollection.requests.map((request) =>
        normalizeCollectionRequest(request, "REST")
      ),
      description: data.description ?? null,
      auth: data.auth ?? { authType: "inherit", authActive: true },
      headers: addDescriptionField(data.headers),
      variables: data.variables ?? [],
      preRequestScript: data.preRequestScript ?? "",
      testScript: data.testScript ?? "",
    })
  }
  const gqlCollection = collection as ExportedUserCollectionGQL
  const data = gqlCollection.data ? (JSON.parse(gqlCollection.data) ?? {}) : {}
  return makeCollection({
    id: gqlCollection.id,
    _ref_id: data._ref_id ?? generateUniqueRefId("coll"),
    name: gqlCollection.name,
    folders: gqlCollection.folders.map((folder) =>
      exportedCollectionToHoppCollection(folder, collectionType)
    ),
    requests: gqlCollection.requests.map((request) =>
      normalizeCollectionRequest(request, "GQL")
    ),
    auth: data.auth ?? { authType: "inherit", authActive: true },
    headers: addDescriptionField(data.headers),
    variables: data.variables ?? [],
    description: data.description ?? null,
    preRequestScript: data.preRequestScript ?? "",
    testScript: data.testScript ?? "",
  })
}
function mergeTwoCollections(
  local: HoppCollection,
  fetched: HoppCollection
): HoppCollection {
  if (isRootRequestCollection(fetched)) {
    // 根目录以服务端为准，保留尚未确认的本地请求，防止旧缓存复活已删除的记录。
    const fetchedRefs = new Set(fetched.requests.map((item) => item._ref_id))
    return {
      ...fetched,
      requests: [
        ...fetched.requests,
        ...local.requests.filter(
          (item) => !item.id && !fetchedRefs.has(item._ref_id)
        ),
      ],
    }
  }
  const mergedFolders: HoppCollection[] = []
  const fetchedFoldersMap = new Map<string, HoppCollection>()
  for (const f of fetched.folders) {
    if (f.id) fetchedFoldersMap.set(f.id, f)
  }
  const processedFetchedFolderIds = new Set<string>()
  for (const localFolder of local.folders) {
    if (localFolder.id) {
      const fetchedFolder = fetchedFoldersMap.get(localFolder.id)
      if (fetchedFolder) {
        mergedFolders.push(mergeTwoCollections(localFolder, fetchedFolder))
        processedFetchedFolderIds.add(localFolder.id)
      } else {
        mergedFolders.push(localFolder)
      }
    } else {
      mergedFolders.push(localFolder)
    }
  }
  for (const fetchedFolder of fetched.folders) {
    if (fetchedFolder.id && !processedFetchedFolderIds.has(fetchedFolder.id)) {
      mergedFolders.push(fetchedFolder)
    }
  }
  const mergedRequests: typeof fetched.requests = []
  const fetchedRequestsMap = new Map<string, any>()
  for (const r of fetched.requests) {
    if (r.id) fetchedRequestsMap.set(r.id, r)
  }
  const processedFetchedRequestIds = new Set<string>()
  for (const localReq of local.requests) {
    if (localReq.id) {
      const fetchedReq = fetchedRequestsMap.get(localReq.id)
      if (fetchedReq) {
        mergedRequests.push(fetchedReq)
        processedFetchedRequestIds.add(localReq.id)
      } else {
        mergedRequests.push(localReq)
      }
    } else {
      mergedRequests.push(localReq)
    }
  }
  for (const fetchedReq of fetched.requests) {
    if (fetchedReq.id && !processedFetchedRequestIds.has(fetchedReq.id)) {
      mergedRequests.push(fetchedReq)
    }
  }
  return {
    ...fetched,
    folders: mergedFolders,
    requests: mergedRequests,
  }
}
function mergeCollections(
  localCollections: HoppCollection[],
  fetchedCollections: HoppCollection[]
): HoppCollection[] {
  const fetchedMap = new Map<string, HoppCollection>()
  for (const col of fetchedCollections) {
    if (col.id) {
      fetchedMap.set(col.id, col)
    }
  }
  const merged: HoppCollection[] = []
  const processedFetchedIds = new Set<string>()
  for (const localCol of localCollections) {
    if (localCol.id) {
      const fetchedCol = fetchedMap.get(localCol.id)
      if (fetchedCol) {
        merged.push(mergeTwoCollections(localCol, fetchedCol))
        processedFetchedIds.add(localCol.id)
      } else if (!isRootRequestCollection(localCol)) {
        merged.push(localCol)
      }
    } else {
      merged.push(localCol)
    }
  }
  for (const fetchedCol of fetchedCollections) {
    if (fetchedCol.id && !processedFetchedIds.has(fetchedCol.id)) {
      merged.push(fetchedCol)
    }
  }
  return merged
}
async function loadUserCollections(collectionType: "REST" | "GQL") {
  if (!import.meta.env.VITE_WORKBENCH_NATIVE && !window.__APIREQUEST_NATIVE__ &&
      platform.auth.localSessionState?.value === "ready") {
    const remote = await import("~/helpers/remote-collections")
    remote.setRemoteCollectionInstaller((tree) =>
      applyLocalWorkspaceSnapshot("REST", restCollectionStore.value.state, tree))
    // Preserve the existing adoption path for device-only collections.
    const pending = restCollectionStore.value.state.filter((item) => !item.id)
    if (pending.length) {
      await axios.post(`${import.meta.env.VITE_BACKEND_API_URL}/auth/local-collections`, {
        collectionType,
        collectionsJSON: JSON.stringify(pending.map(translateToPersonalCollectionFormat)),
      }, { withCredentials: true, headers: { "X-Workbench-Local": "1" } })
    }
    await remote.initRemoteCollectionIndex()
    return
  }
  const res = await exportUserCollectionsToJSON(
    undefined,
    collectionType == "REST" ? ReqType.Rest : ReqType.Gql
  )
  if (E.isRight(res)) {
    const localCollections =
      collectionType === "REST"
        ? restCollectionStore.value.state
        : restCollectionStore.value.state
    const localMode = platform.auth.localSessionState?.value
    const pending =
      localMode && localMode !== "account"
        ? localCollections.filter((item) => !item.id)
        : []
    let collectionsJSONString =
      res.right.exportUserCollectionsToJSON.exportedCollection
    if (pending.length) {
      try {
        const adopted = await axios.post<{
          exportedCollection: string
        }>(
          `${import.meta.env.VITE_BACKEND_API_URL}/auth/local-collections`,
          {
            collectionType,
            collectionsJSON: JSON.stringify(
              pending.map(translateToPersonalCollectionFormat)
            ),
          },
          { withCredentials: true, headers: { "X-Workbench-Local": "1" } }
        )
        collectionsJSONString = adopted.data.exportedCollection
      } catch (error) {
        console.error(
          "Failed to attach device collections to the local workspace",
          error
        )
        return
      }
    }
    const exportedCollections = (
      JSON.parse(collectionsJSONString) as Array<
        ExportedUserCollectionGQL | ExportedUserCollectionREST
      >
    ).map((collection) => ({ v: 1, ...collection }))
    const fetchedCollections = exportedCollections.map(
      (collection) =>
        exportedCollectionToHoppCollection(
          collection,
          collectionType
        ) as HoppCollection
    )
    if (localMode && localMode !== "account") {
      applyLocalWorkspaceSnapshot(
        collectionType,
        localCollections,
        fetchedCollections
      )
    } else {
      const mergedCollections = mergeCollections(
        localCollections,
        fetchedCollections
      )
      runDispatchWithOutSyncing(() => {
        collectionType === "REST"
          ? setRESTCollections(mergedCollections)
          : setRESTCollections(mergedCollections)
      })
    }
  }
}
export function applyLocalWorkspaceSnapshot(
  collectionType: "REST" | "GQL",
  previous: HoppCollection[],
  fetched: HoppCollection[]
) {
  const findRequest = indexSyncedRequests(fetched)
  const protocol = collectionType === "REST" ? "rest" : "graphql"
  const tabs =
    collectionType === "REST"
      ? getService(WorkspaceTabsService).getTabsRefTo(
          (tab) =>
            "saveContext" in tab.document &&
            tab.document.saveContext?.originLocation === "user-collection"
        )
      : []
  // 数据库返回的集合和顺序是权威版本。保留正在编辑的标签页，并重绑其保存位置。
  runDispatchWithOutSyncing(() => {
    collectionType === "REST"
      ? setRESTCollections(fetched)
      : setRESTCollections(fetched)
  })
  for (const tab of tabs) {
    const doc = tab.value.document
    if (doc.type === "websocket" || doc.type === "test-runner") continue
    if (!("saveContext" in doc)) continue
    const context = doc.saveContext
    if (context?.originLocation !== "user-collection") continue
    const folder = navigateToFolderWithIndexPath(
      previous,
      context.folderPath.split("/").map(Number)
    )
    const original =
      context.requestIndex === undefined
        ? undefined
        : folder?.requests[context.requestIndex]
    const refID = "requestRefID" in context ? context.requestRefID : undefined
    const tabRequest = "request" in doc ? doc.request : undefined
    const identity = tabRequest ?? (refID ? {} : original)
    const location = identity && findRequest(identity, refID)
    const next =
      location &&
      navigateToFolderWithIndexPath(
        fetched,
        location.folderPath.split("/").map(Number)
      )?.requests[location.requestIndex]
    const exampleName =
      "type" in doc &&
      (doc.type === "example-response" || doc.type === "gql-example-response")
        ? doc.response.name
        : undefined
    if (
      !location ||
      !next ||
      (exampleName && !isCollectionRequestSummary(next) && !Object.hasOwn(next.responses, exampleName))
    ) {
      doc.saveContext = undefined
      doc.inheritedProperties = undefined
      continue
    }
    context.folderPath = location.folderPath
    context.requestIndex = location.requestIndex
    if ("exampleID" in context && exampleName && !isCollectionRequestSummary(next)) {
      context.exampleID = String(
        Object.keys(next.responses).indexOf(exampleName)
      )
    }
    if ("type" in doc) {
      doc.saveContext = { ...context, requestRefID: next._ref_id ?? next.id }
    }
    doc.inheritedProperties = cascadeParentCollectionForProperties(
      location.folderPath,
      protocol
    )
    if (doc.isDirty || !tabRequest) continue
    const updated = cloneDeep(next)
    if (!("type" in doc) || doc.type === "gql-request") {
      if (!isGQLRequest(updated)) continue
      doc.request = updated
    } else if (doc.type === "request" && !isGQLRequest(updated)) {
      doc.request = updated
    }
    // 刷新已保存的请求不会产生编辑；等请求编辑器的变更检测先处理。
    void nextTick(() => {
      if ("request" in doc && doc.request === updated) doc.isDirty = false
    })
  }
}
function setupSubscriptions() {
  let subs: ReturnType<typeof runGQLSubscription>[1][] = []
  const userCollectionCreatedSub = setupUserCollectionCreatedSubscription()
  const userCollectionUpdatedSub = setupUserCollectionUpdatedSubscription()
  const userCollectionRemovedSub = setupUserCollectionRemovedSubscription()
  const userCollectionMovedSub = setupUserCollectionMovedSubscription()
  const userCollectionOrderUpdatedSub =
    setupUserCollectionOrderUpdatedSubscription()
  const userCollectionDuplicatedSub =
    setupUserCollectionDuplicatedSubscription()
  const userRootCollectionsSortedSub =
    setupUserRootCollectionsSortedSubscription()
  const userChildCollectionSortedSub =
    setupUserChildCollectionSortedSubscription()
  const userRequestCreatedSub = setupUserRequestCreatedSubscription()
  const userRequestUpdatedSub = setupUserRequestUpdatedSubscription()
  const userRequestDeletedSub = setupUserRequestDeletedSubscription()
  const userRequestMovedSub = setupUserRequestMovedSubscription()
  subs = [
    userCollectionCreatedSub,
    userCollectionUpdatedSub,
    userCollectionRemovedSub,
    userCollectionMovedSub,
    userCollectionOrderUpdatedSub,
    userCollectionDuplicatedSub,
    userRootCollectionsSortedSub,
    userChildCollectionSortedSub,
    userRequestCreatedSub,
    userRequestUpdatedSub,
    userRequestDeletedSub,
    userRequestMovedSub,
  ]
  return () => {
    subs.forEach((sub) => sub.unsubscribe())
  }
}
function setupUserCollectionCreatedSubscription() {
  const [userCollectionCreated$, userCollectionCreatedSub] =
    runUserCollectionCreatedSubscription()
  userCollectionCreated$.subscribe((res) => {
    if (E.isRight(res)) {
      const collectionType = res.right.userCollectionCreated.type
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const userCollectionBackendID = res.right.userCollectionCreated.id
      const parentCollectionID = res.right.userCollectionCreated.parent?.id
      const userCollectionLocalID = getCollectionPathFromCollectionID(
        userCollectionBackendID,
        collectionStore.value.state
      )
      // collection already exists in store ( this instance created it )
      if (userCollectionLocalID) {
        return
      }
      const parentCollectionPath =
        parentCollectionID &&
        getCollectionPathFromCollectionID(
          parentCollectionID,
          collectionStore.value.state
        )
      // only folders will have parent collection id
      if (parentCollectionID && parentCollectionPath) {
        runDispatchWithOutSyncing(() => {
          collectionType == "GQL"
            ? addRESTFolder(
                res.right.userCollectionCreated.title,
                parentCollectionPath
              )
            : addRESTFolder(
                res.right.userCollectionCreated.title,
                parentCollectionPath
              )
          const parentCollection = navigateToFolderWithIndexPath(
            collectionStore.value.state,
            parentCollectionPath
              .split("/")
              .map((pathIndex) => parseInt(pathIndex))
          )
          if (parentCollection) {
            const folderIndex = parentCollection.folders.length - 1
            const addedFolder = parentCollection.folders[folderIndex]
            addedFolder.id = userCollectionBackendID
          }
        })
      } else {
        // root collections won't have parentCollectionID
        const data =
          res.right.userCollectionCreated.data &&
          res.right.userCollectionCreated.data != "null"
            ? JSON.parse(res.right.userCollectionCreated.data)
            : {
                auth: { authType: "inherit", authActive: true },
                headers: [],
                _ref_id: generateUniqueRefId("coll"),
                variables: [],
                description: null,
              }
        runDispatchWithOutSyncing(() => {
          collectionType == "GQL"
            ? addRESTCollection(
                makeCollection({
                  name: res.right.userCollectionCreated.title,
                  folders: [],
                  requests: [],
                  _ref_id: data._ref_id,
                  auth: data.auth ?? { authType: "inherit", authActive: true },
                  headers: addDescriptionField(data.headers),
                  variables: data.variables ?? [],
                  description: data.description ?? null,
                  preRequestScript: data.preRequestScript ?? "",
                  testScript: data.testScript ?? "",
                })
              )
            : addRESTCollection(
                makeCollection({
                  name: res.right.userCollectionCreated.title,
                  folders: [],
                  requests: [],
                  _ref_id: data._ref_id,
                  auth: data.auth ?? { authType: "inherit", authActive: true },
                  headers: addDescriptionField(data.headers),
                  variables: data.variables ?? [],
                  description: data.description ?? null,
                  preRequestScript: data.preRequestScript ?? "",
                  testScript: data.testScript ?? "",
                })
              )
          const localIndex = collectionStore.value.state.length - 1
          const addedCollection = collectionStore.value.state[localIndex]
          addedCollection.id = userCollectionBackendID
        })
      }
    }
  })
  return userCollectionCreatedSub
}
function setupUserCollectionUpdatedSubscription() {
  const [userCollectionUpdated$, userCollectionUpdatedSub] =
    runUserCollectionUpdatedSubscription()
  userCollectionUpdated$.subscribe((res) => {
    if (E.isRight(res)) {
      const {
        id: updatedCollectionBackendID,
        title,
        type: collectionType,
        data,
      } = res.right.userCollectionUpdated
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const updatedCollectionLocalPath = getCollectionPathFromCollectionID(
        updatedCollectionBackendID,
        collectionStore.value.state
      )
      if (!updatedCollectionLocalPath) return
      const isFolder = updatedCollectionLocalPath.split("/").length > 1
      // Carry auth, headers, variables, and scripts from the data payload
      const {
        auth,
        headers,
        variables,
        description,
        preRequestScript,
        testScript,
      } =
        data && data != "null"
          ? JSON.parse(data)
          : {
              auth: { authType: "inherit", authActive: true },
              headers: [],
              variables: [],
              description: null,
              preRequestScript: "",
              testScript: "",
            }
      const partialUpdate: Partial<HoppCollection> = {
        name: title,
        auth,
        headers: addDescriptionField(headers),
        variables: variables ?? [],
        description: description ?? null,
        preRequestScript: preRequestScript ?? "",
        testScript: testScript ?? "",
      }
      runDispatchWithOutSyncing(() => {
        if (isFolder) {
          collectionType == "REST"
            ? editRESTFolder(updatedCollectionLocalPath, partialUpdate)
            : editRESTFolder(updatedCollectionLocalPath, partialUpdate)
        } else {
          collectionType == "REST"
            ? editRESTCollection(
                parseInt(updatedCollectionLocalPath),
                partialUpdate
              )
            : editRESTCollection(
                parseInt(updatedCollectionLocalPath),
                partialUpdate
              )
        }
      })
    }
  })
  return userCollectionUpdatedSub
}
function setupUserCollectionMovedSubscription() {
  const [userCollectionMoved$, userCollectionMovedSub] =
    runUserCollectionMovedSubscription()
  userCollectionMoved$.subscribe((res) => {
    if (E.isRight(res)) {
      const movedMetadata = res.right.userCollectionMoved
      const collectionType = movedMetadata.type
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const sourcePath = getCollectionPathFromCollectionID(
        movedMetadata.id,
        collectionStore.value.state
      )
      let destinationPath: string | undefined
      if (movedMetadata.parent?.id) {
        destinationPath =
          getCollectionPathFromCollectionID(
            movedMetadata.parent?.id,
            collectionStore.value.state
          ) ?? undefined
      }
      sourcePath &&
        runDispatchWithOutSyncing(() => {
          collectionType === "GQL"
            ? moveRESTFolder(sourcePath, destinationPath ?? null)
            : moveRESTFolder(sourcePath, destinationPath ?? null)
        })
    }
  })
  return userCollectionMovedSub
}
function setupUserCollectionRemovedSubscription() {
  const [userCollectionRemoved$, userCollectionRemovedSub] =
    runUserCollectionRemovedSubscription()
  userCollectionRemoved$.subscribe((res) => {
    if (E.isRight(res)) {
      const removedCollectionBackendID = res.right.userCollectionRemoved.id
      const collectionType = res.right.userCollectionRemoved.type
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const removedCollectionLocalPath = getCollectionPathFromCollectionID(
        removedCollectionBackendID,
        collectionStore.value.state
      )
      const isFolder =
        removedCollectionLocalPath &&
        removedCollectionLocalPath.split("/").length > 1
      if (removedCollectionLocalPath && isFolder) {
        runDispatchWithOutSyncing(() => {
          collectionType == "REST"
            ? removeRESTFolder(removedCollectionLocalPath)
            : removeRESTFolder(removedCollectionLocalPath)
        })
      }
      if (removedCollectionLocalPath && !isFolder) {
        runDispatchWithOutSyncing(() => {
          collectionType == "REST"
            ? removeRESTCollection(parseInt(removedCollectionLocalPath))
            : removeRESTCollection(parseInt(removedCollectionLocalPath))
        })
      }
    }
  })
  return userCollectionRemovedSub
}
function setupUserCollectionOrderUpdatedSubscription() {
  const [userCollectionOrderUpdated$, userCollectionOrderUpdatedSub] =
    runUserCollectionOrderUpdatedSubscription()
  userCollectionOrderUpdated$.subscribe((res) => {
    if (E.isRight(res)) {
      const { userCollection, nextUserCollection } =
        res.right.userCollectionOrderUpdated
      const sourceCollectionID = userCollection.id
      const destinationCollectionID = nextUserCollection?.id
      // The OrderUpdated payload does not include a `type` field, so
      // determine which store owns the source ID by lookup.
      const collectionType = locateCollectionType(sourceCollectionID)
      if (!collectionType) return
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const sourcePath = getCollectionPathFromCollectionID(
        sourceCollectionID,
        collectionStore.value.state
      )
      let destinationPath: string | null | undefined
      if (destinationCollectionID) {
        destinationPath = getCollectionPathFromCollectionID(
          destinationCollectionID,
          collectionStore.value.state
        )
      }
      runDispatchWithOutSyncing(() => {
        if (sourcePath) {
          collectionType === "GQL"
            ? updateRESTCollectionOrder(sourcePath, destinationPath ?? null)
            : updateRESTCollectionOrder(sourcePath, destinationPath ?? null)
        }
      })
    }
  })
  return userCollectionOrderUpdatedSub
}
function setupUserCollectionDuplicatedSubscription() {
  const [userCollectionDuplicated$, userCollectionDuplicatedSub] =
    runUserCollectionDuplicatedSubscription()
  userCollectionDuplicated$.subscribe((res) => {
    if (E.isRight(res)) {
      const {
        childCollections: childCollectionsJSONStr,
        data,
        id,
        parentID: parentCollectionID,
        requests: userRequests,
        title: name,
        type: collectionType,
      } = res.right.userCollectionDuplicated
      const { collectionStore } = getStoreByCollectionType(collectionType)
      const duplicatedCollectionAlreadyApplied =
        getCollectionPathFromCollectionID(id, collectionStore.value.state)
      if (duplicatedCollectionAlreadyApplied) {
        return
      }
      const parentCollectionPath =
        parentCollectionID &&
        getCollectionPathFromCollectionID(
          parentCollectionID,
          collectionStore.value.state
        )
      // Incoming data transformed to the respective internal representations
      const {
        auth,
        headers,
        variables,
        description,
        preRequestScript,
        testScript,
      } =
        data && data != "null"
          ? JSON.parse(data)
          : {
              auth: { authType: "inherit", authActive: true },
              headers: [],
              variables: [],
              description: null,
              preRequestScript: "",
              testScript: "",
            }
      // Duplicated collection will have a unique ref id
      const _ref_id = generateUniqueRefId("coll")
      const folders = transformDuplicatedCollections(
        childCollectionsJSONStr,
        collectionType
      )
      const requests = transformDuplicatedCollectionRequests(
        userRequests as UserRequest[],
        collectionType
      )
      // New collection to be added to store with the transformed data
      const effectiveDuplicatedCollection: HoppCollection = makeCollection({
        id,
        name,
        folders,
        requests,
        _ref_id,
        auth,
        headers: addDescriptionField(headers),
        variables: variables ?? [],
        description: description ?? null,
        preRequestScript: preRequestScript ?? "",
        testScript: testScript ?? "",
      })
      // only folders will have parent collection id
      if (parentCollectionID && parentCollectionPath) {
        const collectionCreatedFromStoreIDSuffix = "-duplicate-collection"
        const parentCollection = navigateToFolderWithIndexPath(
          collectionStore.value.state,
          parentCollectionPath
            .split("/")
            .map((pathIndex) => parseInt(pathIndex))
        )
        if (!parentCollection) {
          return
        }
        // Grab the child collection inserted via store update with the ID suffix
        const collectionInsertedViaStoreUpdateIdx =
          parentCollection.folders.findIndex(({ id }) =>
            id?.endsWith(collectionCreatedFromStoreIDSuffix)
          )
        runDispatchWithOutSyncing(() => {
          if (collectionInsertedViaStoreUpdateIdx === -1) {
            // Cross-device duplicate: no local placeholder to remove, just add it
            const newFolderPath = `${parentCollectionPath}/${parentCollection.folders.length}`
            if (collectionType === "GQL") {
              addRESTFolder(name, parentCollectionPath)
              editRESTFolder(newFolderPath, effectiveDuplicatedCollection)
            } else {
              addRESTFolder(name, parentCollectionPath)
              editRESTFolder(newFolderPath, effectiveDuplicatedCollection)
            }
          } else {
            const collectionInsertedViaStoreUpdateIndexPath = `${parentCollectionPath}/${collectionInsertedViaStoreUpdateIdx}`
            // After remove + append, the new folder sits at the last index;
            // editing the placeholder path now would hit a shifted sibling.
            const newFolderPath = `${parentCollectionPath}/${parentCollection.folders.length - 1}`
            if (collectionType === "GQL") {
              removeRESTFolder(collectionInsertedViaStoreUpdateIndexPath)
              addRESTFolder(name, parentCollectionPath)
              editRESTFolder(newFolderPath, effectiveDuplicatedCollection)
            } else {
              removeRESTFolder(collectionInsertedViaStoreUpdateIndexPath)
              addRESTFolder(name, parentCollectionPath)
              editRESTFolder(newFolderPath, effectiveDuplicatedCollection)
            }
          }
        })
      } else {
        // root collections won't have `parentCollectionID`
        const collectionCreatedFromStoreIDSuffix = "-duplicate-collection"
        // Grab the child collection inserted via store update with the ID suffix
        const collectionInsertedViaStoreUpdateIdx =
          collectionStore.value.state.findIndex(({ id }) =>
            id?.endsWith(collectionCreatedFromStoreIDSuffix)
          )
        runDispatchWithOutSyncing(() => {
          if (collectionInsertedViaStoreUpdateIdx === -1) {
            if (collectionType === "GQL") {
              addRESTCollection(effectiveDuplicatedCollection)
            } else {
              addRESTCollection(effectiveDuplicatedCollection)
            }
          } else {
            if (collectionType === "GQL") {
              removeRESTCollection(collectionInsertedViaStoreUpdateIdx)
              addRESTCollection(effectiveDuplicatedCollection)
            } else {
              removeRESTCollection(collectionInsertedViaStoreUpdateIdx)
              addRESTCollection(effectiveDuplicatedCollection)
            }
          }
        })
      }
    }
  })
  return userCollectionDuplicatedSub
}
const setupUserRootCollectionsSortedSubscription = () => {
  const [userRootCollectionsSorted$, userRootCollectionsSortedSub] =
    runUserRootCollectionsSortedSubscription()
  userRootCollectionsSorted$.subscribe((res) => {
    if (E.isRight(res)) {
      runDispatchWithOutSyncing(() => {
        if (res.right.userRootCollectionsSorted) {
          const { sortOption } = res.right.userRootCollectionsSorted
          const sortOrder = sortOption === "TITLE_ASC" ? "asc" : "desc"
          // TODO: UserCollectionSortData does not carry a REST/GQL type
          // discriminator, so we can't route a root-level sort event to the
          // correct store. Apply to whichever store is non-empty; if both
          // are populated this will be ambiguous — needs a backend schema
          // change to add `type` to UserCollectionSortData.
          const restHasState = restCollectionStore.value.state.length > 0
          const gqlHasState = restCollectionStore.value.state.length > 0
          if (restHasState && !gqlHasState) {
            sortRESTCollection(null, sortOrder)
          } else if (gqlHasState && !restHasState) {
            sortRESTCollection(null, sortOrder)
          } else {
            // Ambiguous (both or neither store has state): skip until backend
            // includes a type discriminator in UserCollectionSortData.
            return
          }
        }
      })
    }
  })
  return userRootCollectionsSortedSub
}
const setupUserChildCollectionSortedSubscription = () => {
  const [userChildCollectionSorted$, userChildCollectionSortedSub] =
    runUserChildCollectionSortedSubscription()
  userChildCollectionSorted$.subscribe((res) => {
    if (E.isRight(res)) {
      runDispatchWithOutSyncing(() => {
        if (res.right.userChildCollectionsSorted) {
          const { parentCollectionID, sortOption } =
            res.right.userChildCollectionsSorted
          if (!parentCollectionID) return
          const sortOrder = sortOption === "TITLE_ASC" ? "asc" : "desc"
          // ChildCollectionSorted payload does not include a `type` field,
          // so resolve store membership from the parent ID.
          const collectionType = locateCollectionType(parentCollectionID)
          if (!collectionType) return
          const { collectionStore } = getStoreByCollectionType(collectionType)
          const sourcePath = getCollectionPathFromCollectionID(
            parentCollectionID,
            collectionStore.value.state
          )
          if (!sourcePath) return
          collectionType === "GQL"
            ? sortRESTFolder(sourcePath, sortOrder)
            : sortRESTFolder(sourcePath, sortOrder)
        }
      })
    }
  })
  return userChildCollectionSortedSub
}
function setupUserRequestCreatedSubscription() {
  const [userRequestCreated$, userRequestCreatedSub] =
    runUserRequestCreatedSubscription()
  userRequestCreated$.subscribe((res) => {
    if (E.isRight(res)) {
      const collectionID = res.right.userRequestCreated.collectionID
      const requestType = res.right.userRequestCreated.type
      const request = normalizeCollectionRequest(
        JSON.parse(res.right.userRequestCreated.request),
        requestType
      )
      const requestID = res.right.userRequestCreated.id
      const { collectionStore } = getStoreByCollectionType(requestType)
      const hasAlreadyHappened = getRequestPathFromRequestID(
        requestID,
        collectionStore.value.state
      )
      if (!!hasAlreadyHappened) {
        return
      }
      const collectionPath = getCollectionPathFromCollectionID(
        collectionID,
        collectionStore.value.state
      )
      if (collectionID && collectionPath) {
        const target = navigateToFolderWithIndexPath(
          collectionStore.value.state,
          collectionPath.split("/").map(Number)
        )
        if (!target) return
        // 本地先显示根请求。订阅先于写入响应到达时补齐同一条记录的后端 ID。
        if (isRootRequestCollection(target) && request._ref_id) {
          const local = target.requests.find(
            (item) => !item.id && item._ref_id === request._ref_id
          )
          if (local) {
            local.id = requestID
            return
          }
        }
        runDispatchWithOutSyncing(() => {
          requestType == "REST"
            ? saveRESTRequestAs(collectionPath, request)
            : saveRESTRequestAs(collectionPath, request as HoppGQLRequest)
          const targetRequest = target.requests.at(-1)
          if (targetRequest) {
            targetRequest.id = requestID
          }
        })
      }
    }
  })
  return userRequestCreatedSub
}
function setupUserRequestUpdatedSubscription() {
  const [userRequestUpdated$, userRequestUpdatedSub] =
    runUserRequestUpdatedSubscription()
  userRequestUpdated$.subscribe((res) => {
    if (E.isRight(res)) {
      const requestType = res.right.userRequestUpdated.type
      const { collectionStore } = getStoreByCollectionType(requestType)
      const requestPath = getRequestPathFromRequestID(
        res.right.userRequestUpdated.id,
        collectionStore.value.state
      )
      const collectionPath = requestPath?.collectionPath
      const requestIndex = requestPath?.requestIndex
      const updatedRequest = normalizeCollectionRequest(
        JSON.parse(res.right.userRequestUpdated.request),
        requestType
      )
      ;(requestIndex || requestIndex == 0) &&
        collectionPath &&
        runDispatchWithOutSyncing(() => {
          requestType == "REST"
            ? editRESTRequest(collectionPath, requestIndex, updatedRequest)
            : editRESTRequest(
                collectionPath,
                requestIndex,
                updatedRequest as HoppGQLRequest
              )
        })
    }
  })
  return userRequestUpdatedSub
}
function setupUserRequestMovedSubscription() {
  const [userRequestMoved$, userRequestMovedSub] =
    runUserRequestMovedSubscription()
  userRequestMoved$.subscribe((res) => {
    if (E.isRight(res)) {
      const { request, nextRequest } = res.right.userRequestMoved
      const {
        collectionID: destinationCollectionID,
        id: sourceRequestID,
        type: requestType,
      } = request
      const { collectionStore } = getStoreByCollectionType(requestType)
      const sourceRequestPath = getRequestPathFromRequestID(
        sourceRequestID,
        collectionStore.value.state
      )
      const destinationCollectionPath = getCollectionPathFromCollectionID(
        destinationCollectionID,
        collectionStore.value.state
      )
      const destinationRequestIndex = destinationCollectionPath
        ? (() => {
            const requestsLength = navigateToFolderWithIndexPath(
              collectionStore.value.state,
              destinationCollectionPath
                .split("/")
                .map((index) => parseInt(index))
            )?.requests.length
            return requestsLength || requestsLength == 0
              ? requestsLength - 1
              : undefined
          })()
        : undefined
      // there is no nextRequest, so request is moved
      if (destinationCollectionPath && sourceRequestPath && !nextRequest) {
        runDispatchWithOutSyncing(() => {
          requestType == "REST"
            ? moveRESTRequest(
                sourceRequestPath.collectionPath,
                sourceRequestPath.requestIndex,
                destinationCollectionPath
              )
            : moveRESTRequest(
                sourceRequestPath.collectionPath,
                sourceRequestPath.requestIndex,
                destinationCollectionPath
              )
        })
      }
      // there is nextRequest, so request is reordered
      if (
        destinationRequestIndex != null &&
        destinationRequestIndex >= 0 &&
        destinationCollectionPath &&
        nextRequest &&
        // we don't have request reordering for graphql yet
        requestType == "REST"
      ) {
        const { collectionID: nextCollectionID, id: nextRequestID } =
          nextRequest
        const nextCollectionPath =
          getCollectionPathFromCollectionID(
            nextCollectionID,
            collectionStore.value.state
          ) ?? undefined
        const nextRequestIndex = nextCollectionPath
          ? getRequestIndex(
              nextRequestID,
              nextCollectionPath,
              collectionStore.value.state
            )
          : undefined
        // `!== undefined` (not truthy) so cross-tab reorders to position 0
        // still dispatch; `!== -1` guards a getRequestIndex findIndex miss.
        nextRequestIndex !== undefined &&
          nextCollectionPath &&
          sourceRequestPath &&
          runDispatchWithOutSyncing(() => {
            updateRESTRequestOrder(
              sourceRequestPath?.requestIndex,
              nextRequestIndex,
              nextCollectionPath
            )
          })
      }
    }
  })
  return userRequestMovedSub
}
function setupUserRequestDeletedSubscription() {
  const [userRequestDeleted$, userRequestDeletedSub] =
    runUserRequestDeletedSubscription()
  userRequestDeleted$.subscribe((res) => {
    if (E.isRight(res)) {
      const requestType = res.right.userRequestDeleted.type
      const { collectionStore } = getStoreByCollectionType(requestType)
      const deletedRequestPath = getRequestPathFromRequestID(
        res.right.userRequestDeleted.id,
        collectionStore.value.state
      )
      ;(deletedRequestPath?.requestIndex ||
        deletedRequestPath?.requestIndex == 0) &&
        deletedRequestPath.collectionPath &&
        runDispatchWithOutSyncing(() => {
          requestType == "REST"
            ? removeRESTRequest(
                deletedRequestPath.collectionPath,
                deletedRequestPath.requestIndex
              )
            : removeRESTRequest(
                deletedRequestPath.collectionPath,
                deletedRequestPath.requestIndex
              )
        })
    }
  })
  return userRequestDeletedSub
}
export const def: CollectionsPlatformDef = {
  initCollectionsSync,
  loadUserCollections,
  importToPersonalWorkspace,
}
function getCollectionPathFromCollectionID(
  collectionID: string,
  collections: HoppCollection[],
  parentPath?: string
): string | null {
  for (const collectionIndex in collections) {
    if (collections[collectionIndex].id == collectionID) {
      return parentPath
        ? `${parentPath}/${collectionIndex}`
        : `${collectionIndex}`
    }
    const collectionPath = getCollectionPathFromCollectionID(
      collectionID,
      collections[collectionIndex].folders,
      parentPath ? `${parentPath}/${collectionIndex}` : `${collectionIndex}`
    )
    if (collectionPath) return collectionPath
  }
  return null
}
function getRequestPathFromRequestID(
  requestID: string,
  collections: HoppCollection[],
  parentPath?: string
): {
  collectionPath: string
  requestIndex: number
} | null {
  for (const collectionIndex in collections) {
    const requestIndex = collections[collectionIndex].requests.findIndex(
      (request) => request.id == requestID
    )
    if (requestIndex != -1) {
      return {
        collectionPath: parentPath
          ? `${parentPath}/${collectionIndex}`
          : `${collectionIndex}`,
        requestIndex,
      }
    }
    const requestPath = getRequestPathFromRequestID(
      requestID,
      collections[collectionIndex].folders,
      parentPath ? `${parentPath}/${collectionIndex}` : `${collectionIndex}`
    )
    if (requestPath) return requestPath
  }
  return null
}
// Resolves whether a collection ID belongs to the REST or GQL store. Returns
// null if neither store contains it (e.g. event for a workspace not loaded
// yet). Used to disambiguate subscription payloads that don't carry a `type`.
function locateCollectionType(collectionID: string): "REST" | "GQL" | null {
  if (
    getCollectionPathFromCollectionID(
      collectionID,
      restCollectionStore.value.state
    )
  ) {
    return "REST"
  }

  return null
}
function getRequestIndex(
  requestID: string,
  parentCollectionPath: string,
  collections: HoppCollection[]
) {
  const collection = navigateToFolderWithIndexPath(
    collections,
    parentCollectionPath?.split("/").map((index) => parseInt(index))
  )
  const requestIndex = collection?.requests.findIndex(
    (request) => request.id == requestID
  )
  return requestIndex
}
function transformDuplicatedCollections(
  collectionsJSONStr: string,
  collectionType: "REST" | "GQL"
): HoppCollection[] {
  const parsedCollections: UserCollectionDuplicatedData[] =
    JSON.parse(collectionsJSONStr)
  return parsedCollections.map(
    ({
      childCollections: childCollectionsJSONStr,
      data,
      id,
      requests: userRequests,
      title: name,
    }) => {
      const {
        auth,
        headers,
        variables,
        description,
        preRequestScript,
        testScript,
      } =
        data && data !== "null"
          ? JSON.parse(data)
          : {
              auth: { authType: "inherit", authActive: true },
              headers: [],
              variables: [],
              description: null,
              preRequestScript: "",
              testScript: "",
            }
      const _ref_id = generateUniqueRefId("coll")
      const folders = transformDuplicatedCollections(
        childCollectionsJSONStr,
        collectionType
      )
      const requests = transformDuplicatedCollectionRequests(
        userRequests,
        collectionType
      )
      return makeCollection({
        id,
        name,
        folders,
        requests,
        _ref_id,
        auth,
        headers: addDescriptionField(headers),
        variables: variables ?? [],
        description: description ?? null,
        preRequestScript: preRequestScript ?? "",
        testScript: testScript ?? "",
      })
    }
  )
}
function transformDuplicatedCollectionRequests(
  requests: UserRequest[],
  collectionType: "REST" | "GQL"
): HoppRESTRequest[] | HoppGQLRequest[] {
  return requests.map(({ id, request }) => {
    const normalized = normalizeCollectionRequest(
      JSON.parse(request),
      collectionType
    )
    return {
      ...normalized,
      id,
    }
  }) as HoppRESTRequest[] | HoppGQLRequest[]
}
