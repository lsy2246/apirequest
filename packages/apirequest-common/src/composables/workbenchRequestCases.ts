import { readonly, shallowRef } from "vue";
import { cloneDeep } from "lodash-es";
import { Store } from "~/kernel/store";
import { platform } from "~/platform";
import { PersistenceService, STORE_NAMESPACE } from "~/services/persistence";
import { getService } from "~/modules/dioc";
import { CaseMapSchema, type CaseMap, type RequestCase } from "~/helpers/request-cases/model";
export type { RequestCase } from "~/helpers/request-cases/model"

const KEY = "workbench.request-cases.v1"
const cases = shallowRef<CaseMap>({})
let loading: Promise<void> | undefined
let pending = Promise.resolve()
let database: Promise<IDBDatabase> | undefined

// 文件样本不放入容量较小的 localStorage，桌面端沿用工作区存储。
function browserDB() {
  database ??= new Promise((resolve, reject) => {
    const open = indexedDB.open("apirequest-request-cases", 1)
    open.onupgradeneeded = () => open.result.createObjectStore("cases")
    open.onsuccess = () => resolve(open.result)
    open.onerror = () => {
      database = undefined
      reject(open.error)
    }
  })
  return database
}
async function browserStore(value?: CaseMap): Promise<unknown> {
  const db = await browserDB()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      "cases",
      value ? "readwrite" : "readonly"
    )
    const operation = value
      ? transaction.objectStore("cases").put(value, KEY)
      : transaction.objectStore("cases").get(KEY)
    transaction.oncomplete = () => resolve(operation.result)
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error ?? new Error("Storage failed"))
  })
}
async function write(value: CaseMap) {
  if (platform.localDesktop) {
    const result = await Store.set(STORE_NAMESPACE, KEY, value)
    if (result._tag === "Left") throw new Error(result.left.message)
  } else await browserStore(value)
  cases.value = value
}
async function load() {
  if (platform.localDesktop) {
    const result = await Store.get<unknown>(STORE_NAMESPACE, KEY)
    if (result._tag === "Left") throw new Error(result.left.message)
    cases.value = CaseMapSchema.parse(result.right ?? {})
  } else {
    const saved = await browserStore()
    if (saved !== undefined) cases.value = CaseMapSchema.parse(saved)
    else {
      const legacy =
        getService(PersistenceService).hoppLocalConfigStorage.getItem(KEY)
      await write(CaseMapSchema.parse(legacy ? JSON.parse(legacy) : {}))
    }
  }
}
export function useWorkbenchRequestCases() {
  loading ??= load().catch((error) => {
    loading = undefined
    throw error
  })
  const ready = loading
  return {
    cases: readonly(cases),
    ready,
    update(
      requestId: string,
      mutate: (entries: RequestCase[]) => RequestCase[]
    ) {
      const operation = pending.then(async () => {
        await ready
        const value = cases.value
        const existing = Object.hasOwn(value, requestId) ? value[requestId] : []
        await write(
          CaseMapSchema.parse({
            ...value,
            [requestId]: mutate(cloneDeep(existing)),
          })
        )
      })
      pending = operation.catch(() => undefined)
      return operation
    },
  }
}
