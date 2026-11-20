let database: Promise<IDBDatabase | undefined> | undefined

function open() {
  database ??= new Promise<IDBDatabase | undefined>((resolve) => {
    try {
      const request = indexedDB.open("apirequest-workspace-cache", 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore("index")
        request.result.createObjectStore("requests")
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(undefined)
      request.onblocked = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
  return database
}

export async function readCollectionCache<T>(store: "index" | "requests", key: string): Promise<T | undefined> {
  const db = await open()
  if (!db) return undefined
  return new Promise((resolve) => {
    try {
      const request = db.transaction(store).objectStore(store).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => resolve(undefined)
    } catch { resolve(undefined) }
  })
}

export async function writeCollectionCache(store: "index" | "requests", key: string, value: unknown): Promise<void> {
  const db = await open()
  if (!db) return
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(store, "readwrite")
      // Values can come from Vue proxies; serialize only this individual
      // detail or the small index, never the complete workspace tree.
      transaction.objectStore(store).put(JSON.parse(JSON.stringify(value)), key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = transaction.onabort = () => resolve()
    } catch { resolve() }
  })
}
