import { Service } from "dioc";
import { SpotlightResultTextType, SpotlightSearcher, SpotlightSearcherResult, SpotlightSearcherSessionState, SpotlightService } from "../";
import { cloneDeep } from "lodash-es";
import { Ref, computed, effectScope, markRaw, ref, watch } from "vue";
import { getI18n } from "~/modules/i18n";
import MiniSearch from "minisearch";
import { cascadeParentCollectionForProperties, restCollectionStore } from "~/newstore/collections";
import IconFolder from "~icons/lucide/folder";
import IconImport from "~icons/lucide/folder-down";
import RESTRequestSpotlightEntry from "~/components/app/spotlight/entry/RESTRequest.vue";
import { HoppCollection, HoppGQLRequest, HoppRESTRequest } from "@apirequest/data";
import { WorkspaceService } from "~/services/workspace.service";
import { invokeAction } from "~/helpers/actions";
import { isGQLRequest } from "~/helpers/request-type";
import { ensureRemoteRequest, remoteRequestLocation } from "~/helpers/remote-collections";
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs";
/**
 * A spotlight searcher that searches through the user's collections
 *
 * NOTE: Initializing this service registers it as a searcher with the Spotlight Service.
 */
export class CollectionsSpotlightSearcherService
  extends Service
  implements SpotlightSearcher
{
  public static readonly ID = "COLLECTIONS_SPOTLIGHT_SEARCHER_SERVICE"
  private t = getI18n()
  public searcherID = "collections"
  public searcherSectionTitle = this.t("collection.my_collections")
  private readonly workspaceTab = this.bind(WorkspaceTabsService)
  private readonly spotlight = this.bind(SpotlightService)
  private readonly workspaceService = this.bind(WorkspaceService)
  override onServiceInit() {
    this.spotlight.registerSearcher(this)
  }

  private loadRESTDocsIntoMinisearch(minisearch: MiniSearch) {
    const restDocsQueue = [
      ...restCollectionStore.value.state.map((coll, index) => ({
        coll: coll,
        index: `${index}`,
      })),
    ]
    while (restDocsQueue.length > 0) {
      const { coll, index } = restDocsQueue.shift()!
      restDocsQueue.push(
        ...coll.folders.map((folder, folderIndex) => ({
          coll: folder,
          index: `${index}/${folderIndex}`,
        }))
      )
      minisearch.addAll(
        coll.requests.map((req, reqIndex) => ({
          id: `rest-${index}/${reqIndex}`,
          name: req.name,
        }))
      )
    }
  }
  private getCurrentPageCategory() {
    return window.location.pathname === "/" ? "rest" : "other"
  }
  public createSearchSession(
    query: Readonly<Ref<string>>
  ): [Ref<SpotlightSearcherSessionState>, () => void] {
    const pageCategory = this.getCurrentPageCategory()
    const minisearch = new MiniSearch({
      fields: ["name"],
      storeFields: ["name"],
      searchOptions: {
        prefix: true,
        fuzzy: true,
        boost: {
          name: 2,
        },
        weights: {
          fuzzy: 0.2,
          prefix: 0.8,
        },
      },
    })
    if (pageCategory === "rest" || pageCategory === "graphql") {
      minisearch.add({
        id: `create-collection`,
        name: this.t("collection.new"),
      })
      minisearch.add({
        id: "import-collection",
        name: this.t("collection.import"),
      })
    }
    if (pageCategory === "rest") {
      this.loadRESTDocsIntoMinisearch(minisearch)
    } else if (pageCategory === "graphql") {
    }
    const results = ref<SpotlightSearcherResult[]>([])
    const scopeHandle = effectScope()
    const newCollectionText: SpotlightResultTextType<any> = {
      type: "text",
      text: this.t("collection.new"),
    }
    const importCollectionText: SpotlightResultTextType<any> = {
      type: "text",
      text: this.t("collection.import_collection"),
    }
    scopeHandle.run(() => {
      const isPersonalWorkspace = computed(
        () => this.workspaceService.currentWorkspace.value.type === "personal"
      )
      watch(query, (query) => {
        if (pageCategory === "other") {
          results.value = []
          return
        }
        const getResultText = (id: string): SpotlightResultTextType<any> => {
          if (id === "create-collection") return newCollectionText
          else if (id === "import-collection") return importCollectionText
          return {
            type: "custom",
            component: markRaw(RESTRequestSpotlightEntry),
            componentProps: {
              folderPath: id.split(
                pageCategory === "rest" ? "rest-" : "gql-"
              )[1],
            },
          }
        }
        const getResultIcon = (id: string) => {
          if (id === "import-collection") return markRaw(IconImport)
          return markRaw(IconFolder)
        }
        const searchResults = minisearch.search(query).slice(0, 10)
        results.value = searchResults.map((result) => ({
          id: result.id,
          text: getResultText(result.id),
          icon: getResultIcon(result.id),
          score: result.score,
        }))
      })
    })
    const resultObj = computed<SpotlightSearcherSessionState>(() => ({
      loading: false,
      results: results.value,
    }))
    return [
      resultObj,
      () => {
        scopeHandle.stop()
      },
    ]
  }
  private getRESTFolderFromFolderPath(
    folderPath: string
  ): HoppCollection | undefined {
    try {
      const folderIndicies = folderPath.split("/").map((x) => parseInt(x))
      let currentFolder =
        restCollectionStore.value.state[folderIndicies.shift()!]
      while (folderIndicies.length > 0) {
        const folderIndex = folderIndicies.shift()!
        const folder = currentFolder.folders[folderIndex]
        currentFolder = folder
      }
      return currentFolder
    } catch (e) {
      console.error(e)
      return undefined
    }
  }

  public async onResultSelect(result: SpotlightSearcherResult): Promise<void> {
    if (result.id === "create-collection") return invokeAction("collection.new")
    if (result.id === "import-collection")
      return invokeAction(`modals.collection.import`)
    const [type, path] = result.id.split("-")
    if (type === "rest") {
      const folderPath = path.split("/").map((x) => parseInt(x))
      let reqIndex = folderPath.pop()!
      let resolvedFolderPath = folderPath.join("/")
      let req =
        this.getRESTFolderFromFolderPath(resolvedFolderPath)?.requests[reqIndex]
      if (!req) return
      try { req = await ensureRemoteRequest(req) }
      catch (error) { console.error("接口详情加载失败", error); return }
      const location = remoteRequestLocation(req)
      if (location) { reqIndex = location.requestIndex; resolvedFolderPath = location.folderPath }
      // Record `requestRefID` like the sidebar does — a tab opened without one
      // isn't matched by lookups that supply it, and the request opens twice
      const saveContext = {
        originLocation: "user-collection",
        folderPath: resolvedFolderPath,
        requestIndex: reqIndex,
        requestRefID: req._ref_id ?? req.id,
      } as const
      const possibleTab =
        this.workspaceTab.getTabRefWithSaveContext(saveContext)
      if (possibleTab) {
        this.workspaceTab.setActiveTab(possibleTab.value.id)
      } else {
        // Collections hold mixed types — route GQL requests to a gql tab
        if (isGQLRequest(req)) {
          this.workspaceTab.createNewTab(
            {
              type: "gql-request",
              request: cloneDeep(req) as HoppGQLRequest,
              isDirty: false,
              cursorPosition: 0,
              saveContext,
              inheritedProperties: cascadeParentCollectionForProperties(
                resolvedFolderPath,
                "rest"
              ),
            },
            true
          )
        } else {
          this.workspaceTab.createNewTab(
            {
              type: "request",
              request: cloneDeep(req) as HoppRESTRequest,
              isDirty: false,
              saveContext,
              inheritedProperties: cascadeParentCollectionForProperties(
                resolvedFolderPath,
                "rest"
              ),
            },
            true
          )
        }
      }
    } else {
    }
  }
}
