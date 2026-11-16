import { beforeEach, describe, expect, it, vi } from "vitest"
import { webcrypto } from "node:crypto"
const mocks = vi.hoisted(() => ({
  snapshot: vi.fn(),
  import: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
}))
vi.mock("../workspace", () => ({
  snapshot: mocks.snapshot,
  importEntries: mocks.import,
}))
vi.mock("../cloud", () => ({
  defaultConnection: (provider: string) => ({
    provider,
    url: "",
    username: "",
    password: "",
    fileName: "a.json",
    clientId: "",
    clientSecret: "",
  }),
  readCloud: mocks.read,
  writeCloud: mocks.write,
}))
vi.mock("~/helpers/native-workbench-config", () => ({
  readLocal: mocks.load,
  writeLocal: mocks.save,
}))
import {
  commitSync,
  prepareSync,
  connectionKey,
  loadSyncState,
  syncState,
  type State,
} from "../engine"
import { makePackage, decodePackage, type Entry } from "../model"
const entry = (id = "environment:a", value = "local"): Entry => ({
  id,
  kind: "environment",
  name: id,
  data: { value },
  dependencies: [],
  omitted: [],
})
const state = (): State => ({
  provider: "webdav",
  webdav: {
    provider: "webdav",
    url: "https://dav.example/",
    username: "me",
    password: "pass",
    fileName: "sync.json",
    clientId: "",
    clientSecret: "",
  },
  google: {
    provider: "google",
    url: "",
    username: "",
    password: "",
    fileName: "sync.json",
    clientId: "",
    clientSecret: "",
  },
  selected: ["environments"],
  auto: false,
  baseline: {},
})
beforeEach(() => {
  vi.resetAllMocks()
  Object.defineProperty(crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  })
  mocks.import.mockResolvedValue(undefined)
  mocks.save.mockResolvedValue(undefined)
})
describe("selective bidirectional synchronization", () => {
  it("discards removed advanced options while preserving cloud connection credentials", async () => {
    mocks.load.mockResolvedValue({
      ...state(),
      sensitive: true,
      attachments: false,
      password: "old-package-password",
    })
    await loadSyncState()
    expect(syncState.value).not.toHaveProperty("sensitive")
    expect(syncState.value).not.toHaveProperty("attachments")
    expect(syncState.value).not.toHaveProperty("password")
    expect(syncState.value.webdav.password).toBe("pass")
    mocks.snapshot.mockResolvedValue([entry()])
    mocks.read.mockResolvedValue({ text: null, version: null })
    const preview = await prepareSync(syncState.value)
    await commitSync(syncState.value, preview)
    expect(mocks.snapshot).toHaveBeenCalledWith(false, true, false)
    expect(
      (await decodePackage(mocks.write.mock.calls[0][1])).entries
    ).toHaveLength(1)
    expect(mocks.save.mock.calls[0][1]).not.toHaveProperty("password")
  })
  it("includes all remote entries in a selected module", async () => {
    const config = state(),
      local = entry(),
      remote = { ...entry(undefined, "cloud"), dependencies: ["environment:b"] }
    mocks.snapshot.mockResolvedValue([local])
    mocks.read.mockResolvedValue({
      text: JSON.stringify(
        makePackage([remote, entry("environment:b", "dependency")])
      ),
      version: '"1"',
    })
    expect((await prepareSync(config)).selected).toContain("environment:b")
  })
  it("keeps unrelated cloud configuration while uploading only the selected item", async () => {
    const config = state(),
      local = entry(),
      untouched = {
        ...entry("preference:BG_COLOR", "untouched"),
        kind: "preference" as const,
      }
    mocks.snapshot.mockResolvedValue([local])
    mocks.read.mockResolvedValue({
      text: JSON.stringify(makePackage([untouched])),
      version: '"1"',
    })
    const preview = await prepareSync(config)
    await commitSync(config, preview)
    const written = await decodePackage(mocks.write.mock.calls[0][1])
    expect(written.entries).toEqual([local, untouched])
    expect(mocks.import).not.toHaveBeenCalled()
    expect(config.baseline[connectionKey(config)]).toHaveProperty(local.id)
  })
  it("does not overwrite a local edit made while the preview is open", async () => {
    const config = state()
    mocks.snapshot.mockResolvedValue([entry()])
    mocks.read.mockResolvedValue({ text: null, version: null })
    const preview = await prepareSync(config)
    mocks.snapshot.mockResolvedValue([entry(undefined, "edited after preview")])
    await expect(commitSync(config, preview)).rejects.toThrow("本地配置已变化")
    expect(mocks.write).not.toHaveBeenCalled()
    expect(mocks.import).not.toHaveBeenCalled()
  })
  it("validates downloads before uploading and leaves local data intact on remote conflict", async () => {
    const config = state(),
      local = entry(),
      remote = entry("environment:b", "cloud")
    mocks.snapshot.mockResolvedValue([local])
    mocks.read.mockResolvedValue({
      text: JSON.stringify(makePackage([remote])),
      version: '"1"',
    })
    mocks.write.mockRejectedValue(new Error("云端配置已变化"))
    const preview = await prepareSync(config)
    await expect(commitSync(config, preview)).rejects.toThrow("云端配置已变化")
    expect(mocks.import).toHaveBeenCalledTimes(1)
    expect(mocks.import.mock.calls[0][2]).toBe(true)
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it("can keep both conflicting configurations with separate stable identities", async () => {
    const config = state(),
      local = entry(),
      remote = entry(undefined, "cloud")
    mocks.snapshot.mockResolvedValue([local])
    mocks.read.mockResolvedValue({
      text: JSON.stringify(makePackage([remote])),
      version: '"1"',
    })
    const preview = await prepareSync(config)
    preview.rows[0].choice = "both"
    await commitSync(config, preview)
    const written = await decodePackage(mocks.write.mock.calls[0][1])
    expect(written.entries).toHaveLength(2)
    expect(written.entries.find((e) => e.id === local.id)?.data).toEqual(
      local.data
    )
    expect(written.entries.find((e) => e.id !== local.id)?.data.value).toBe(
      "cloud"
    )
  })
})
