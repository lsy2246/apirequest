import { Service } from "dioc";
import * as E from "fp-ts/Either";
import { getService } from "~/modules/dioc";

import { PersistenceService } from "~/services/persistence";
import { KernelInterceptorService } from "~/services/kernel-interceptor.service";

import { platform } from "~/platform";
import { NativeKernelInterceptorService } from "~/platform/std/kernel-interceptors/native";

import { initBackendGQLClient } from "~/helpers/backend/GQLClient";
import { getKernelMode } from "@apirequest/kernel";
import { diag } from "~/kernel/log";

const loadWebSync = import.meta.env.VITE_WORKBENCH_NATIVE
  ? null
  : () => import("~/lib/sync/defs")

type InitEvent =
  | { type: "STORE_READY" }
  | { type: "PERSISTENCE_FIRST_READY" }
  | { type: "PERSISTENCE_LATER_READY" }
  | { type: "TABS_READY" }
  | { type: "NATIVE_KERNEL_NETWORKING_READY" }
  | { type: "AUTH_READY" }
  | { type: "BACKEND_CLIENT_READY" }
  | { type: "SYNC_READY" }
  | { type: "ALL_READY" }

/**
 * Service responsible for coordinating the initialization sequence.
 */
export class InitializationService extends Service<InitEvent> {
  public static readonly ID = "INITIALIZATION_SERVICE"

  private initState = {
    store: false,
    persistenceFirst: false,
    tabs: false,
    nativeKernelNetworking: false,
    auth: false,
    sync: false,
    persistenceLater: false,
    backendClient: false,
  }

  private async initStore() {
    const persistenceService = getService(PersistenceService)
    const result = await persistenceService.init()

    if (E.isLeft(result)) {
      throw new Error(`Store initialization failed: ${result.left.message}`)
    }

    this.initState.store = true
    this.emit({ type: "STORE_READY" })
  }

  private async initPersistenceFirst() {
    if (!this.initState.store) {
      throw new Error("Cannot initialize persistence before store")
    }

    const persistenceService = getService(PersistenceService)
    await persistenceService.setupFirst()

    this.initState.persistenceFirst = true
    this.emit({ type: "PERSISTENCE_FIRST_READY" })
  }

  private async initTabs() {
    if (!this.initState.persistenceFirst) {
      throw new Error("Cannot initialize tabs before persistence")
    }

    if (!window.__APIREQUEST_NATIVE__) {
      await getService(PersistenceService).setupWorkspaceTabsPersistence()
    }
    // 原生统一标签在 setupLater 校验通过后加载。

    this.initState.tabs = true
    this.emit({ type: "TABS_READY" })
  }

  private async initNativeKernelNetworking() {
    const interceptorService = getService(KernelInterceptorService)
    const nativeInterceptorService = getService(NativeKernelInterceptorService)
    interceptorService.register(nativeInterceptorService)
    interceptorService.setActive("native")

    this.initState.nativeKernelNetworking = true
    this.emit({ type: "NATIVE_KERNEL_NETWORKING_READY" })
  }

  private async initAuth() {
    if (
      getKernelMode() === "desktop" &&
      !this.initState.nativeKernelNetworking
    ) {
      throw new Error(
        "Cannot initialize auth on desktop before native networking"
      )
    }

    if (!this.initState.persistenceFirst || !this.initState.tabs) {
      throw new Error("Cannot initialize auth before persistence and tabs")
    }

    await platform.auth.performAuthInit()

    this.initState.auth = true
    this.emit({ type: "AUTH_READY" })
  }

  private async initBackendClient() {
    if (!import.meta.env.VITE_WORKBENCH_NATIVE && !platform.localDesktop) {
      await initBackendGQLClient()
    }

    this.initState.backendClient = true
    this.emit({ type: "BACKEND_CLIENT_READY" })
  }

  private async initPersistenceLater() {
    if (!this.initState.persistenceFirst) {
      throw new Error("Cannot initialize persistence before store")
    }

    const persistenceService = getService(PersistenceService)
    await persistenceService.setupLater()

    this.initState.persistenceLater = true
    this.emit({ type: "PERSISTENCE_LATER_READY" })
  }

  private async initSync() {
    if (!this.initState.auth) {
      throw new Error("Cannot initialize remaining services before auth")
    }

    if (!loadWebSync) return
    const { sync } = await loadWebSync()
    await Promise.all([
      sync.settings.initSettingsSync(),
      sync.collections.initCollectionsSync(),
      sync.history.initHistorySync(),
      sync.environments.initEnvironmentsSync(),
      platform.analytics?.initAnalytics(),
    ])

    this.emit({ type: "SYNC_READY" })
  }

  public async initPre() {
    diag("init", "initPre() start")
    await this.initStore()
    diag("init", "initPre() store done")
    await this.initPersistenceFirst()
    diag("init", "initPre() persistenceFirst done")

    if (getKernelMode() === "desktop") {
      await this.initNativeKernelNetworking()
      diag("init", "initPre() nativeKernelNetworking done")
    }

    await this.initBackendClient()
    diag("init", "initPre() backendClient done")
    await this.initTabs()
    diag("init", "initPre() tabs done, initPre complete")
  }

  public async initAuthAndSync() {
    diag("init", "initAuthAndSync() start")
    await this.initAuth()
    diag("init", "initAuthAndSync() auth done")
    if (window.__APIREQUEST_NATIVE__) {
      // 桌面端仅从本地 SQLite 加载工作区，避免远端同步覆盖已保存的数据。
      await this.initPersistenceLater()
      const { initNativeHistory } = await import("~/lib/sync/history/native")
      await initNativeHistory()
      this.initState.sync = true
      this.emit({ type: "SYNC_READY" })
      return
    }
    // 单人工作台先加载设备缓存，再用服务端快照同步，避免稍晚读取的缓存覆盖集合。
    if (platform.auth.localSessionState?.value === "ready") {
      await this.initPersistenceLater()
    }
    await this.initSync()
    diag("init", "initAuthAndSync() sync done, initAuthAndSync complete")
  }

  public async initPost() {
    diag("init", "initPost() start")
    if (!this.initState.persistenceLater) await this.initPersistenceLater()
    diag("init", "initPost() persistenceLater done")
    diag("init", "initPost() complete")
  }

  public isInitialized() {
    return Object.values(this.initState).every(Boolean)
  }
}
