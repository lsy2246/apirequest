import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
import * as E from "fp-ts/Either"
import { getDefaultRESTRequest, makeCollection } from "@apirequest/data"
import { Subject } from "rxjs"
import { PersistenceService, STORE_KEYS, STORE_NAMESPACE } from "../index"
import { Store } from "~/kernel/store"
import { restCollectionStore, setRESTCollections } from "~/newstore/collections"

vi.mock("~/kernel/store", () => ({
  Store: { get: vi.fn(), set: vi.fn(), remove: vi.fn(), init: vi.fn() },
}))
vi.mock("~/services/tab/workspace-tabs", () => ({
  WorkspaceTabsService: class {},
}))
vi.mock("~/newstore/collections", () => ({
  restCollectionStore: { subject$: new Subject() },
  setRESTCollections: vi.fn(),
}))
vi.mock("~/newstore/history", () => ({
  graphqlHistoryStore: {},
  restHistoryStore: {},
  setGraphqlHistoryEntries: vi.fn(),
  setRESTHistoryEntries: vi.fn(),
  translateToNewGQLHistory: vi.fn(),
  translateToNewRESTHistory: vi.fn(),
}))

const fixture = () =>
  makeCollection({
    name: "saved",
    folders: [],
    requests: [getDefaultRESTRequest()],
    auth: { authType: "inherit", authActive: true },
    headers: [],
    variables: [],
    description: null,
    preRequestScript: "",
    testScript: "",
  })
const service = () =>
  Object.assign(Object.create(PersistenceService.prototype), {
    showErrorToast: vi.fn(),
  }) as any

describe("current collection persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(Store.set).mockResolvedValue(E.right(undefined))
    ;(restCollectionStore as any).subject$ = new Subject()
  })
  afterEach(() => {
    window.__APIREQUEST_NATIVE__ = false
  })
  it.each([false, true])(
    "restores current collections (native=%s)",
    async (native) => {
      window.__APIREQUEST_NATIVE__ = native
      const saved = [fixture()]
      vi.mocked(Store.get).mockResolvedValue(E.right(saved))
      await service().setupRESTCollectionsPersistence()
      expect(setRESTCollections).toHaveBeenCalledWith(saved)
      expect(Store.set).not.toHaveBeenCalled()
    }
  )
  it("backs up unsupported web data without overwriting it", async () => {
    const old = [{ ...fixture(), v: 11 }]
    vi.mocked(Store.get).mockResolvedValue(E.right(old))
    await service().setupRESTCollectionsPersistence()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).toHaveBeenCalledWith(
      STORE_NAMESPACE,
      `${STORE_KEYS.REST_COLLECTIONS}-backup`,
      old
    )
    expect(Store.set).not.toHaveBeenCalledWith(
      STORE_NAMESPACE,
      STORE_KEYS.REST_COLLECTIONS,
      expect.anything()
    )
  })
  it("keeps unsupported native data intact", async () => {
    window.__APIREQUEST_NATIVE__ = true
    vi.mocked(Store.get).mockResolvedValue(E.right([{ ...fixture(), v: 11 }]))
    await service().setupRESTCollectionsPersistence()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).not.toHaveBeenCalled()
  })
  it("does not replace native collections after a failed read", async () => {
    window.__APIREQUEST_NATIVE__ = true
    vi.mocked(Store.get).mockResolvedValue(
      E.left({ message: "read failed" } as any)
    )
    const persistence = service()
    await persistence.setupRESTCollectionsPersistence()
    expect(persistence.showErrorToast).toHaveBeenCalledOnce()
    expect(setRESTCollections).not.toHaveBeenCalled()
    expect(Store.set).not.toHaveBeenCalled()
  })
})
