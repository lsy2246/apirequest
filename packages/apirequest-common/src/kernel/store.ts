import type { StorageOptions, StoreError, StoreEvents, StoreEventEmitter, ScopedStore } from "@apirequest/kernel";
import { extendStore } from "@apirequest/kernel";
import * as E from "fp-ts/Either";
import { getModule } from ".";
import { diag } from "./log";

// SQLite 的作用域沿用已发布工作区中的键。
export const NATIVE_STORE_SCOPE = "localhost.apirequest.store"

function createScopedStore(storePath: string) {
  const module = () => getModule("store")

  return {
    capabilities: () => module().capabilities,

    init: async () => {
      diag("store", `Store.init(${storePath}) called with path:`, storePath)
      const result = await module().init(storePath)
      diag("store", `Store.init(${storePath}) completed for path:`, storePath)
      return result
    },

    set: async (
      namespace: string,
      key: string,
      value: unknown,
      options?: StorageOptions
    ): Promise<E.Either<StoreError, void>> => {
      diag(
        "store",
        `Store.set(${namespace}, ${key}) on ${storePath}:`,
        storePath
      )
      return module().set(storePath, namespace, key, value, options)
    },

    get: async <T>(
      namespace: string,
      key: string
    ): Promise<E.Either<StoreError, T | undefined>> => {
      diag(
        "store",
        `Store.get(${namespace}, ${key}) on ${storePath}:`,
        storePath
      )
      const result = await module().get<T>(storePath, namespace, key)
      if (E.isRight(result)) {
        const val = result.right
        const shape =
          val === undefined
            ? "undefined"
            : val === null
              ? "null"
              : typeof val === "object"
                ? `object(${Object.keys(val as Record<string, unknown>).length} keys)`
                : typeof val
        diag(
          "store",
          `Store.get(${namespace}, ${key}) on ${storePath} => Right(${shape})`
        )
      } else {
        diag(
          "store",
          `Store.get(${namespace}, ${key}) on ${storePath} => Left:`,
          result.left
        )
      }
      return result
    },

    remove: async (
      namespace: string,
      key: string
    ): Promise<E.Either<StoreError, boolean>> => {
      return module().remove(storePath, namespace, key)
    },

    clear: async (namespace?: string): Promise<E.Either<StoreError, void>> => {
      return module().clear(storePath, namespace)
    },

    has: async (
      namespace: string,
      key: string
    ): Promise<E.Either<StoreError, boolean>> => {
      return module().has(storePath, namespace, key)
    },

    listNamespaces: async (): Promise<E.Either<StoreError, string[]>> => {
      return module().listNamespaces(storePath)
    },

    listKeys: async (
      namespace: string
    ): Promise<E.Either<StoreError, string[]>> => {
      return module().listKeys(storePath, namespace)
    },

    watch: async (
      namespace: string,
      key: string
    ): Promise<StoreEventEmitter<StoreEvents>> => {
      return module().watch(storePath, namespace, key)
    },

    extend: async (namespace: string): Promise<ScopedStore> => {
      return extendStore(module(), storePath, namespace)
    },
  } as const
}

export const Store = createScopedStore(
  window.__APIREQUEST_NATIVE__
    ? NATIVE_STORE_SCOPE
    : `${window.location.host}.apirequest.store`
)
