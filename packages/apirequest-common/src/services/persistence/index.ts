/* eslint-disable no-restricted-globals, no-restricted-syntax */

import * as E from "fp-ts/Either"
import { z } from "zod"

import { Service } from "dioc"
import {
  debounceFilter,
  StorageLike,
  useEventListener,
  watchDebounced,
  watchWithFilter,
} from "@vueuse/core"
import {
  CollectionSchemaVersion,
  EnvironmentSchemaVersion,
  GQL_REQ_SCHEMA_VERSION,
  GlobalEnvironmentVariable,
  HoppCollection,
  RESTReqSchemaVersion,
} from "@apirequest/data"

import { StoreError } from "@apirequest/kernel"

import { openBrowserTabStore } from "./browser-tab-store"
import { Store } from "~/kernel/store"
import { platform } from "~/platform"
import { diag } from "~/kernel/log"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import {
  SecretEnvironmentService,
  SecretVariable,
} from "../secret-environment.service"

import { useToast } from "~/composables/toast"
import {
  restCollectionStore,
  setRESTCollections,
} from "../../newstore/collections"

import {
  addGlobalEnvVariable,
  environments$,
  globalEnv$,
  replaceEnvironments,
  selectedEnvironmentIndex$,
  setGlobalEnvVariables,
  setSelectedEnvironmentIndex,
} from "../../newstore/environments"

import {
  graphqlHistoryStore,
  restHistoryStore,
  setGraphqlHistoryEntries,
  setRESTHistoryEntries,
  translateToNewGQLHistory,
  translateToNewRESTHistory,
} from "../../newstore/history"

import { bulkApplyLocalState, localStateStore } from "../../newstore/localstate"
import {
  bulkApplySettings,
  getDefaultSettings,
  settingsStore,
} from "../../newstore/settings"
import {
  CURRENT_ENVIRONMENT_VALUE_SCHEMA,
  CURRENT_SORT_VALUES_SCHEMA,
  ENVIRONMENTS_SCHEMA,
  GLOBAL_ENVIRONMENT_SCHEMA,
  GQL_HISTORY_ENTRY_SCHEMA,
  LOCAL_STATE_SCHEMA,
  REST_COLLECTION_SCHEMA,
  REST_HISTORY_ENTRY_SCHEMA,
  WORKSPACE_TABS_STATE_SCHEMA,
  SECRET_ENVIRONMENT_VARIABLE_SCHEMA,
  SELECTED_ENV_INDEX_SCHEMA,
  SETTINGS_SCHEMA,
} from "./validation-schemas"
import { PersistableTabState } from "../tab"
import { HoppTabDocument } from "~/helpers/tab/document"
import {
  CurrentValueService,
  Variable,
} from "../current-environment-value.service"
import {
  CurrentSortOption,
  CurrentSortValuesService,
} from "../current-sort.service"

export const STORE_NAMESPACE = "persistence.v1"

export const STORE_KEYS = {
  SETTINGS: "settings",
  LOCAL_STATE: "localState",
  REST_HISTORY: "restHistory",
  GQL_HISTORY: "gqlHistory",
  REST_COLLECTIONS: "restCollections",
  ENVIRONMENTS: "environments",
  SELECTED_ENV: "selectedEnv",
  GLOBAL_ENV: "globalEnv",
  REST_TABS: "restTabs",
  SECRET_ENVIRONMENTS: "secretEnvironments",
  CURRENT_ENVIRONMENT_VALUE: "currentEnvironmentValue",
  CURRENT_SORT_VALUES: "currentSortValues",
} as const

export class PersistenceService extends Service {
  public static readonly ID = "PERSISTENCE_SERVICE"

  // TODO: Consider swapping this with platform dependent `StoreLike` impl
  public hoppLocalConfigStorage: StorageLike = localStorage

  private readonly workspaceTabsService = this.bind(WorkspaceTabsService)
  private readonly secretEnvironmentService = this.bind(
    SecretEnvironmentService
  )
  private readonly currentEnvironmentValueService =
    this.bind(CurrentValueService)

  private readonly currentSortValuesService = this.bind(
    CurrentSortValuesService
  )

  private showErrorToast(key: string) {
    const toast = useToast()
    toast.error(
      `Schema validation failed for ${STORE_NAMESPACE}:${key}. A backup has been created with suffix '-backup'`
    )
  }

  async init(): Promise<E.Either<StoreError, void>> {
    diag(
      "persistence",
      "PersistenceService.init() called, about to Store.init()"
    )
    const initResult = await Store.init()
    if (E.isLeft(initResult)) {
      diag(
        "persistence",
        "PersistenceService Store.init() FAILED:",
        initResult.left
      )
      console.error(
        "[PersistenceService] Failed to initialize store:",
        initResult.left
      )
      return initResult
    }
    diag("persistence", "PersistenceService Store.init() succeeded")
    return initResult
  }

  private async setupLocalStatePersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.LOCAL_STATE
    )

    try {
      if (E.isRight(loadResult)) {
        const data = loadResult.right ?? {}
        const result = LOCAL_STATE_SCHEMA.safeParse(data)

        if (result.success) {
          bulkApplyLocalState(result.data)
        } else {
          this.showErrorToast(STORE_KEYS.LOCAL_STATE)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.LOCAL_STATE}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted LOCAL_STATE:`, loadResult)
    }

    localStateStore.subject$.subscribe(async (state) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.LOCAL_STATE, state)
    })
  }

  private async setupSettingsPersistence() {
    diag(
      "persistence",
      "setupSettingsPersistence() loading settings from store"
    )
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.SETTINGS
    )

    try {
      if (E.isRight(loadResult)) {
        const data = loadResult.right ?? getDefaultSettings()
        diag(
          "persistence",
          "settings loaded, BG_COLOR:",
          data?.BG_COLOR,
          "THEME_COLOR:",
          data?.THEME_COLOR
        )
        diag(
          "persistence",
          "settings keys:",
          data ? Object.keys(data).join(", ") : "(null/default)"
        )
        const result = SETTINGS_SCHEMA.safeParse(data)

        if (result.success) {
          const parsedSettings = result.data
          diag(
            "persistence",
            "settings parsed, BG_COLOR:",
            parsedSettings?.BG_COLOR,
            "THEME_COLOR:",
            parsedSettings?.THEME_COLOR
          )
          bulkApplySettings(parsedSettings)
          diag("persistence", "settings applied via bulkApplySettings")
        } else {
          diag(
            "persistence",
            "settings schema validation FAILED:",
            result.error?.message
          )
          this.showErrorToast(STORE_KEYS.SETTINGS)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.SETTINGS}-backup`,
            data
          )
        }
      } else {
        diag(
          "persistence",
          "settings load returned Left (error):",
          loadResult.left
        )
      }
    } catch (_e) {
      diag("persistence", "settings parse error:", String(_e))
      console.error(`Failed parsing persisted SETTINGS:`, loadResult)
    }

    settingsStore.subject$.subscribe(async (settings) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.SETTINGS, settings)
    })
  }

  private async setupRESTHistoryPersistence() {
    if (window.__APIREQUEST_NATIVE__) return
    const restLoadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.REST_HISTORY
    )

    try {
      if (E.isRight(restLoadResult)) {
        const data = restLoadResult.right ?? []
        const result = z.array(REST_HISTORY_ENTRY_SCHEMA).safeParse(data)

        if (result.success) {
          const translatedData = result.data.map(translateToNewRESTHistory)
          setRESTHistoryEntries(translatedData)
        } else {
          console.error(
            `Failed parsing persisted REST_HISTORY:`,
            result.error.message
          )
          this.showErrorToast(STORE_KEYS.REST_HISTORY)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.REST_HISTORY}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted REST_HISTORY:`, restLoadResult)
    }

    restHistoryStore.subject$.subscribe(async ({ state }) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.REST_HISTORY, state)
    })
  }

  private async setupGQLHistoryPersistence() {
    if (window.__APIREQUEST_NATIVE__) return
    const gqlLoadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.GQL_HISTORY
    )

    try {
      if (E.isRight(gqlLoadResult)) {
        const data = gqlLoadResult.right ?? []
        const result = z.array(GQL_HISTORY_ENTRY_SCHEMA).safeParse(data)

        if (result.success) {
          const translatedData = result.data.map(translateToNewGQLHistory)
          setGraphqlHistoryEntries(translatedData)
        } else {
          this.showErrorToast(STORE_KEYS.GQL_HISTORY)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.GQL_HISTORY}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted GQL_HISTORY:`, gqlLoadResult)
    }

    graphqlHistoryStore.subject$.subscribe(async ({ state }) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.GQL_HISTORY, state)
    })
  }

  private async setupRESTCollectionsPersistence() {
    diag(
      "persistence",
      "setupRESTCollectionsPersistence() loading REST collections"
    )
    const restLoadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.REST_COLLECTIONS
    )

    if (window.__APIREQUEST_NATIVE__ && E.isLeft(restLoadResult)) {
      this.showErrorToast(STORE_KEYS.REST_COLLECTIONS)
      return
    }

    if (window.__APIREQUEST_NATIVE__ && E.isRight(restLoadResult)) {
      const collections = this.parseNativeCollections(restLoadResult.right)
      if (!collections) {
        console.error("Invalid native collections; keeping the SQLite data")
        return
      }
      setRESTCollections(collections)
      restCollectionStore.subject$.subscribe(async ({ state }) => {
        await Store.set(STORE_NAMESPACE, STORE_KEYS.REST_COLLECTIONS, state)
      })
      return
    }

    try {
      if (E.isRight(restLoadResult)) {
        const data = restLoadResult.right ?? []
        diag(
          "persistence",
          "REST collections loaded, count:",
          Array.isArray(data) ? data.length : "(not array)",
          "first name:",
          Array.isArray(data) && data[0]?.name ? data[0].name : "(none)"
        )
        const result = z.array(REST_COLLECTION_SCHEMA).safeParse(data)

        if (result.success) {
          const translatedData = result.data
          diag(
            "persistence",
            "REST collections translated, count:",
            translatedData.length
          )
          setRESTCollections(translatedData)
        } else {
          console.error(`Failed with `, result.error.message)
          this.showErrorToast(STORE_KEYS.REST_COLLECTIONS)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.REST_COLLECTIONS}-backup`,
            data
          )
          return
        }
      }
    } catch (error) {
      console.error("Failed parsing persisted REST_COLLECTIONS:", error)
    }

    restCollectionStore.subject$.subscribe(async ({ state }) => {
      // Remote workspaces cache their small index and individual details in
      // IndexedDB. Serializing the entire tree here blocks the main thread and
      // exceeds localStorage's quota even after opening just a few folders.
      if (!window.__APIREQUEST_NATIVE__ && platform?.auth.localSessionState?.value === "ready") return
      await Store.set(STORE_NAMESPACE, STORE_KEYS.REST_COLLECTIONS, state)
    })
  }

  private async setupEnvironmentsPersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.ENVIRONMENTS
    )

    if (window.__APIREQUEST_NATIVE__) {
      const data = E.isRight(loadResult) ? (loadResult.right ?? []) : null
      const result = ENVIRONMENTS_SCHEMA.safeParse(
        Array.isArray(data) &&
          data.every((env) => env?.v === EnvironmentSchemaVersion)
          ? data
          : null
      )
      if (!result.success) {
        console.error("Invalid native environments; keeping the SQLite data")
        return
      }
      replaceEnvironments(result.data)
      environments$.subscribe(async (envs) => {
        await Store.set(STORE_NAMESPACE, STORE_KEYS.ENVIRONMENTS, envs)
      })
      return
    }

    try {
      if (E.isRight(loadResult)) {
        const data = loadResult.right ?? []
        const environments = data

        const result = ENVIRONMENTS_SCHEMA.safeParse(environments)

        if (result.success) {
          // Check for and handle globals
          const globalIndex = result.data.findIndex(
            (x) => x.name.toLowerCase() === "globals"
          )

          if (globalIndex !== -1) {
            const globalEnv = result.data[globalIndex]
            globalEnv.variables.forEach((variable: GlobalEnvironmentVariable) =>
              addGlobalEnvVariable(variable)
            )
            result.data.splice(globalIndex, 1)
          }

          replaceEnvironments(result.data)
        } else {
          this.showErrorToast(STORE_KEYS.ENVIRONMENTS)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.ENVIRONMENTS}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted ENVIRONMENTS:`, loadResult)
    }

    environments$.subscribe(async (envs) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.ENVIRONMENTS, envs)
    })
  }

  private async setupSecretEnvironmentsPersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.SECRET_ENVIRONMENTS
    )

    try {
      if (E.isRight(loadResult) && loadResult.right) {
        const result = SECRET_ENVIRONMENT_VARIABLE_SCHEMA.safeParse(
          loadResult.right
        )

        if (result.success) {
          this.secretEnvironmentService.loadSecretEnvironmentsFromPersistedState(
            result.data
          )
        } else {
          this.showErrorToast(STORE_KEYS.SECRET_ENVIRONMENTS)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.SECRET_ENVIRONMENTS}-backup`,
            loadResult.right
          )
          console.error(
            `Failed parsing persisted SECRET_ENVIRONMENTS:`,
            JSON.stringify(loadResult.right)
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted SECRET_ENVIRONMENTS:`, loadResult)
    }

    watchDebounced(
      this.secretEnvironmentService.persistableSecretEnvironments,
      async (newData: Record<string, SecretVariable[]>) => {
        await Store.set(
          STORE_NAMESPACE,
          STORE_KEYS.SECRET_ENVIRONMENTS,
          newData
        )
      },
      { debounce: 500 }
    )
  }

  private async setupCurrentEnvironmentValuePersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.CURRENT_ENVIRONMENT_VALUE
    )

    try {
      if (E.isRight(loadResult) && loadResult.right) {
        const result = CURRENT_ENVIRONMENT_VALUE_SCHEMA.safeParse(
          loadResult.right
        )

        if (result.success) {
          this.currentEnvironmentValueService.loadEnvironmentsFromPersistedState(
            result.data
          )
        } else {
          this.showErrorToast(STORE_KEYS.CURRENT_ENVIRONMENT_VALUE)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.CURRENT_ENVIRONMENT_VALUE}-backup`,
            loadResult.right
          )
          console.error(
            `Failed parsing persisted CURRENT_ENVIRONMENT_VALUE:`,
            JSON.stringify(loadResult.right)
          )
        }
      }
    } catch (_e) {
      console.error(
        `Failed parsing persisted CURRENT_ENVIRONMENT_VALUE:`,
        loadResult
      )
    }

    watchDebounced(
      this.currentEnvironmentValueService.persistableEnvironments,
      async (newData: Record<string, Variable[]>) => {
        await Store.set(
          STORE_NAMESPACE,
          STORE_KEYS.CURRENT_ENVIRONMENT_VALUE,
          newData
        )
      },
      { debounce: 500 }
    )
  }

  private async setupSelectedEnvPersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.SELECTED_ENV
    )

    try {
      if (E.isRight(loadResult)) {
        const data = loadResult.right ?? { type: "NO_ENV_SELECTED" as const }
        const result = SELECTED_ENV_INDEX_SCHEMA.safeParse(data)

        if (result.success) {
          if (result.data !== null) {
            setSelectedEnvironmentIndex(result.data)
          } else {
            setSelectedEnvironmentIndex({ type: "NO_ENV_SELECTED" })
          }
        } else {
          this.showErrorToast(STORE_KEYS.SELECTED_ENV)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.SELECTED_ENV}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted SELECTED_ENV:`, loadResult)
    }

    selectedEnvironmentIndex$.subscribe(async (index) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.SELECTED_ENV, index)
    })
  }

  private async setupCurrentSortValuesPersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.CURRENT_SORT_VALUES
    )

    try {
      if (E.isRight(loadResult) && loadResult.right) {
        const result = CURRENT_SORT_VALUES_SCHEMA.safeParse(loadResult.right)

        if (result.success) {
          this.currentSortValuesService.loadCurrentSortValuesFromPersistedState(
            result.data
          )
        } else {
          this.showErrorToast(STORE_KEYS.CURRENT_SORT_VALUES)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.CURRENT_SORT_VALUES}-backup`,
            loadResult.right
          )
          console.error(
            `Failed parsing persisted CURRENT_SORT_VALUES:`,
            JSON.stringify(loadResult.right)
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted CURRENT_SORT_VALUES:`, loadResult)
    }

    watchDebounced(
      this.currentSortValuesService.persistableCurrentSortValues,
      async (newData: Record<string, CurrentSortOption>) => {
        await Store.set(
          STORE_NAMESPACE,
          STORE_KEYS.CURRENT_SORT_VALUES,
          newData
        )
      },
      { debounce: 500 }
    )
  }

  private async setupGlobalEnvsPersistence() {
    const loadResult = await Store.get<any>(
      STORE_NAMESPACE,
      STORE_KEYS.GLOBAL_ENV
    )

    try {
      if (E.isRight(loadResult)) {
        const data = loadResult.right ?? []
        const result = GLOBAL_ENVIRONMENT_SCHEMA.safeParse(data)

        if (result.success) {
          setGlobalEnvVariables(result.data)
        } else {
          this.showErrorToast(STORE_KEYS.GLOBAL_ENV)
          await Store.set(
            STORE_NAMESPACE,
            `${STORE_KEYS.GLOBAL_ENV}-backup`,
            data
          )
        }
      }
    } catch (_e) {
      console.error(`Failed parsing persisted GLOBAL_ENV:`, loadResult)
    }

    globalEnv$.subscribe(async (vars) => {
      await Store.set(STORE_NAMESPACE, STORE_KEYS.GLOBAL_ENV, vars)
    })
  }

  public async setupWorkspaceTabsPersistence() {
    const key = STORE_KEYS.REST_TABS
    const native = !!window.__APIREQUEST_NATIVE__
    const browserStore = !native && typeof indexedDB !== "undefined"
      ? await openBrowserTabStore().catch((error) => {
          console.warn("Unable to open browser tab storage", error)
          return undefined
        })
      : undefined
    const write = async (value: unknown, backup = false) => {
      if (browserStore) {
        await browserStore.write(value, backup ? `restTabs-backup-${Date.now()}` : "current")
      } else {
        const result = await Store.set(STORE_NAMESPACE, backup ? `${key}-backup` : key, value)
        if (E.isLeft(result)) throw new Error(result.left.message)
      }
    }

    try {
      let saved = await browserStore?.read()
      if (saved === undefined) {
        // Read the original localStorage (or native SQLite) snapshot on first use.
        const result = await Store.get<unknown>(STORE_NAMESPACE, key)
        if (E.isLeft(result)) throw new Error(result.left.message)
        saved = result.right
      }
      if (saved != null) {
        const result = WORKSPACE_TABS_STATE_SCHEMA.safeParse(saved)
        let state
        if (result.success) {
          state = result.data
        } else {
          if (native) {
            console.error("Invalid native tabs; keeping the SQLite data")
            return
          }
          // Archive the original, including unreadable drafts, before recovering
          // individual documents. One stale entry must not disable future saves.
          await write(saved, true)
          const envelope = z.object({
            orderedDocs: z.array(z.unknown()),
            lastActiveTabID: z.string().catch(""),
          }).safeParse(saved)
          const validTabs = []
          for (const entry of envelope.success ? envelope.data.orderedDocs : []) {
            const tab = WORKSPACE_TABS_STATE_SCHEMA.shape.orderedDocs.element.safeParse(entry)
            if (tab.success) validTabs.push(tab.data)
          }
          state = { orderedDocs: validTabs, lastActiveTabID: envelope.success ? envelope.data.lastActiveTabID : "" }
          await write(state)
          useToast().error("部分旧标签无法读取。已备份原始标签，并恢复可读取的接口。")
        }
        this.workspaceTabsService.loadTabsFromPersistedState(
          state as PersistableTabState<HoppTabDocument>
        )
      }
    } catch (error) {
      console.error("Unable to restore workspace tabs", error)
      useToast().error("读取接口标签失败，请检查浏览器存储后重试。")
      return
    }

    const debounceTabEdits = debounceFilter(500)
    let pendingEdits = false
    let saveErrorShown = false
    const persistTabs = async (newData: PersistableTabState<HoppTabDocument>) => {
      pendingEdits = false
      try {
        await write(newData)
        saveErrorShown = false
      } catch (error) {
        pendingEdits = true
        console.error("Unable to save workspace tabs", error)
        if (!saveErrorShown) useToast().error("接口标签保存失败，请保留当前页面并检查浏览器存储。")
        saveErrorShown = true
      }
    }
    const flushTabs = () => {
      if (!pendingEdits) return
      debounceTabEdits.cancel()
      void persistTabs(this.workspaceTabsService.persistableTabState.value)
    }
    useEventListener(window, "pagehide", flushTabs)
    watchWithFilter(
      this.workspaceTabsService.persistableTabState,
      persistTabs,
      {
        deep: true,
        eventFilter(invoke, options) {
          const [next, previous] = options?.args ?? []
          const sameOrder = next?.orderedDocs.length === previous?.orderedDocs.length &&
            next?.orderedDocs.every((entry: { tabID: string }, index: number) => entry.tabID === previous?.orderedDocs[index]?.tabID)
          if (next?.lastActiveTabID === previous?.lastActiveTabID && sameOrder) {
            pendingEdits = true
            return debounceTabEdits(invoke, options)
          }
          // Opening, closing, switching and reordering tabs must survive an
          // immediate refresh; only edits inside an existing tab are debounced.
          debounceTabEdits.cancel()
          return invoke()
        },
      }
    )
  }

  private parseNativeCollections(value: unknown): HoppCollection[] | undefined {
    const currentCollection = (collection: HoppCollection): boolean =>
      collection?.v === CollectionSchemaVersion &&
      Array.isArray(collection.requests) &&
      collection.requests.every(
        (request) =>
          request !== null &&
          typeof request === "object" &&
          request.v ===
            ("endpoint" in request
              ? RESTReqSchemaVersion
              : GQL_REQ_SCHEMA_VERSION)
      ) &&
      Array.isArray(collection.folders) &&
      collection.folders.every(currentCollection)

    const data = value === undefined ? [] : value
    if (!Array.isArray(data) || !data.every(currentCollection)) return
    const result = z.array(REST_COLLECTION_SCHEMA).safeParse(data)
    if (result.success) return result.data
  }

  public async setupFirst() {
    const initialized = await this.init()
    if (E.isLeft(initialized)) throw new Error(initialized.left.message)
  }

  public async setupLater() {
    diag("persistence", "setupLater() start - loading all persisted data")
    await Promise.all([
      this.setupLocalStatePersistence(),

      this.setupSettingsPersistence(),
      this.setupRESTHistoryPersistence(),
      this.setupGQLHistoryPersistence(),
      this.setupRESTCollectionsPersistence(),

      this.setupEnvironmentsPersistence(),
      this.setupGlobalEnvsPersistence(),
      this.setupSelectedEnvPersistence(),

      window.__APIREQUEST_NATIVE__ ? this.setupWorkspaceTabsPersistence() : undefined,

      this.setupSecretEnvironmentsPersistence(),
      this.setupCurrentEnvironmentValuePersistence(),

      this.setupCurrentSortValuesPersistence(),
    ])
  }

  /**
   * Gets a typed value from persistence, deserialization is automatic.
   * No need to use JSON.parse on the result, it's handled internally by the store.
   * @param key The key to retrieve
   * @returns Either containing the typed value or an error
   */
  public async get<T>(
    key: string
  ): Promise<E.Either<StoreError, T | undefined>> {
    return await Store.get<T>(STORE_NAMESPACE, key)
  }

  /**
   * Gets a value from persistence, discards error and returns null on failure.
   * No need to use JSON.parse on the result, it's handled internally by the store.
   * NOTE: Use this cautiously, try to always use `get`, handling error at call site is better
   * @param key The key to retrieve
   * @returns The typed value or null if not found or on error
   */
  public async getNullable<T>(key: string): Promise<T | null> {
    const r = await Store.get<T>(STORE_NAMESPACE, key)

    if (E.isLeft(r)) return null

    return r.right ?? null
  }

  /**
   * Sets a value in persistence with proper type safety and automatic serialization.
   * No need to use JSON.stringify on the value, it's handled internally by the store.
   * @param key The key to set
   * @param value The value to set (passed directly without manual serialization)
   * @returns Either containing void or an error
   */
  public async set<T>(
    key: string,
    value: T
  ): Promise<E.Either<StoreError, void>> {
    return await Store.set(STORE_NAMESPACE, key, value)
  }

  /**
   * Clear config value from persistence
   * @param key The key to remove
   * @returns Either containing boolean or an error
   */
  public async remove(key: string): Promise<E.Either<StoreError, boolean>> {
    return await Store.remove(STORE_NAMESPACE, key)
  }
}
