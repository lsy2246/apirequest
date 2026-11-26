import { describe, expect, it, vi } from "vitest"
import { HoppCollection, getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import { applyLocalWorkspaceSnapshot, exportedCollectionToHoppCollection } from ".."

const tabs = vi.hoisted(() => ({ current: [] as any[] }))
vi.mock("~/modules/dioc", async (importOriginal) => ({
  ...await importOriginal<typeof import("~/modules/dioc")>(),
  getService: () => ({ getTabsRefTo: () => tabs.current }),
}))

vi.mock("~/modules/i18n", () => ({
  getI18n: () => (key: string) => key,
}))

describe("loading legacy workspace collections", () => {
  it.each(["REST", "GQL"] as const)(
    "loads %s trees containing directories with partial metadata",
    (protocol) => {
      const collection = exportedCollectionToHoppCollection(
        {
          id: "database-root",
          name: "Legacy collection",
          data: JSON.stringify({ _ref_id: "coll_root", headers: [] }),
          folders: [
            {
              id: "database-child",
              name: "Directory without headers",
              data: JSON.stringify({ description: "Keep this description" }),
              folders: [],
              requests: [],
            },
          ],
          requests: [],
        },
        protocol
      )

      expect(HoppCollection.safeParse(collection).type).toBe("ok")
      expect(collection.id).toBe("database-root")
      expect(collection._ref_id).toBe("coll_root")
      expect(collection.folders[0]).toMatchObject({
        id: "database-child",
        headers: [],
        auth: { authType: "inherit", authActive: true },
        variables: [],
        description: "Keep this description",
      })
    }
  )

  it.each(["null", "{}", '{"headers":null}', ""])(
    "preserves requests and database IDs when collection metadata is %j",
    (data) => {
      const request = { ...getDefaultRESTRequest(), id: "database-request" }
      const collection = exportedCollectionToHoppCollection(
        {
          id: "database-collection",
          name: "Imported collection",
          data,
          folders: [],
          requests: [request],
        },
        "REST"
      )

      expect(HoppCollection.safeParse(collection).type).toBe("ok")
      expect(collection.id).toBe("database-collection")
      expect(collection.requests[0].id).toBe("database-request")
      expect(collection.headers).toEqual([])
    }
  )
})

describe("restoring tabs against lazy collection snapshots", () => {
  it("keeps the saved location when the previous tree is empty at startup", () => {
    const document = {
      type: "request" as const, request: { ...getDefaultRESTRequest(), id: "one" }, isDirty: false,
      saveContext: { originLocation: "user-collection" as const, folderPath: "0", requestIndex: 0, requestRefID: "one" },
    }
    tabs.current = [{ value: { document } }]
    const folder = Object.assign(makeCollection({ name: "Root", folders: [], requests: [] }), { id: "root", __workbenchUnloaded: true })
    applyLocalWorkspaceSnapshot("REST", [], [folder])
    expect(document.saveContext).toMatchObject({ requestRefID: "one" })
    expect(document.request.id).toBe("one")
  })

  it("rebinds a summary without replacing the full editor request", () => {
    const request = { ...getDefaultRESTRequest(), id: "one", _ref_id: "one-ref", preRequestScript: "keep()" }
    const document = {
      type: "request" as const, request, isDirty: false,
      saveContext: { originLocation: "user-collection" as const, folderPath: "8", requestIndex: 8, requestRefID: "one-ref" },
    }
    tabs.current = [{ value: { document } }]
    const summary = { id: "one", _ref_id: "one-ref", name: "One", __workbenchSummary: true, responses: {} }
    const folder = makeCollection({ name: "Root", folders: [], requests: [] })
    folder.requests = [summary as unknown as typeof request]
    applyLocalWorkspaceSnapshot("REST", [], [folder])
    expect(document.saveContext).toMatchObject({ folderPath: "0", requestIndex: 0 })
    expect(document.request).toBe(request)
    expect(document.request.preRequestScript).toBe("keep()")
  })

  it("still clears deleted requests when the snapshot is complete", () => {
    const document = {
      type: "request" as const, request: { ...getDefaultRESTRequest(), id: "deleted" }, isDirty: false,
      saveContext: { originLocation: "user-collection" as const, folderPath: "0", requestIndex: 0, requestRefID: "deleted" },
    }
    tabs.current = [{ value: { document } }]
    applyLocalWorkspaceSnapshot("REST", [], [])
    expect(document.saveContext).toBeUndefined()
  })
})
