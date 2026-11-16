import { describe, expect, it, vi } from "vitest"
import { HoppCollection, getDefaultRESTRequest } from "@apirequest/data"
import { exportedCollectionToHoppCollection } from ".."

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
