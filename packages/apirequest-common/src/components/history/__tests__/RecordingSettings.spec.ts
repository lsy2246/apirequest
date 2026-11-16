import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, ref, type App } from "vue"
import RecordingSettings from "../RecordingSettings.vue"
import {
  hasErrorFetchingHistoryStoreStatus,
  isFetchingHistoryStoreStatus,
  isHistoryStoreEnabled,
} from "~/lib/sync/history/status"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  prepare: vi.fn(),
  error: vi.fn(),
  refresh: vi.fn(),
}))
const recording = ref(true)
vi.mock("~/composables/settings", () => ({ useSetting: () => recording }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/toast", () => ({ useToast: () => mocks }))
vi.mock("~/platform", () => ({ platform: { localDesktop: false } }))
vi.mock("~/helpers/workbench-history-results", () => ({
  historyResultAPI: mocks.api,
  ensureFullHistoryStorage: mocks.prepare,
}))
vi.mock("~/lib/sync/history", () => ({ refreshHistory: mocks.refresh }))
let app: App | undefined
function mount() {
  const target = document.createElement("div")
  app = createApp(RecordingSettings)
  app.mount(target)
  return target.querySelector<HTMLButtonElement>("button")!
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockResolvedValue(undefined)
  recording.value = true
  isHistoryStoreEnabled.value = true
  isFetchingHistoryStoreStatus.value = false
  hasErrorFetchingHistoryStoreStatus.value = false
})
afterEach(() => app?.unmount())

describe("history recording control", () => {
  it("enables complete response storage before turning recording back on", async () => {
    recording.value = false
    let complete!: () => void
    mocks.prepare.mockReturnValueOnce(
      new Promise<void>((resolve) => (complete = resolve))
    )
    const toggle = mount()
    toggle.click()
    expect(recording.value).toBe(false)
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    complete()
    await vi.waitFor(() => expect(recording.value).toBe(true))
  })
  it("keeps recording off if complete storage cannot be enabled", async () => {
    recording.value = false
    mocks.prepare.mockRejectedValueOnce(new Error("Storage unavailable"))
    mount().click()
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("history.record_failed")
    )
    expect(recording.value).toBe(false)
  })
  it("pauses new recording locally without deleting or changing server data", async () => {
    mount().click()
    expect(recording.value).toBe(false)
    expect(mocks.api).not.toHaveBeenCalled()
  })
  it("explicitly enables a legacy disabled backend and reloads history", async () => {
    isHistoryStoreEnabled.value = false
    mocks.api.mockResolvedValueOnce({ enabled: true })
    mount().click()
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(mocks.api).toHaveBeenCalledWith("recording/enable", {
      method: "POST",
    })
    expect(recording.value).toBe(true)
  })
  it("keeps the backend disabled and reports an enable failure", async () => {
    isHistoryStoreEnabled.value = false
    mocks.api.mockRejectedValueOnce(new Error("Offline"))
    mount().click()
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("history.record_failed")
    )
    expect(isHistoryStoreEnabled.value).toBe(false)
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})
