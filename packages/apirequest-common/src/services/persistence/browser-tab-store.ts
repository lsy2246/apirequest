import superjson from "superjson"

// Keep a live connection so an edit flushed by pagehide can start its
// transaction synchronously, before the old document is unloaded.
export async function openBrowserTabStore() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("apirequest-workspace-tabs", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("tabs")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return {
    read(): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const request = db.transaction("tabs").objectStore("tabs").get("current")
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }).then((value) => typeof value === "string" ? superjson.parse(value) : value)
    },
    write(value: unknown, key = "current"): Promise<void> {
      return new Promise((resolve, reject) => {
        const serialized = superjson.stringify(value)
        const tx = db.transaction("tabs", "readwrite")
        tx.objectStore("tabs").put(serialized, key)
        tx.oncomplete = () => resolve()
        tx.onerror = tx.onabort = () => reject(tx.error)
      })
    },
  }
}
