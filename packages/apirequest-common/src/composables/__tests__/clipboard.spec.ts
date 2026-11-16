import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope } from "vue"
import { useClipboard } from "../clipboard"

const mocks = vi.hoisted(() => ({
  write: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock("~/helpers/utils/clipboard", () => ({ copyToClipboard: mocks.write }))
vi.mock("../i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("../toast", () => ({ useToast: () => mocks }))
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  scope = effectScope()
  vi.clearAllMocks()
})
afterEach(() => scope.stop())

describe("copy feedback", () => {
  it("shows success only after the write completes and ignores repeat clicks", async () => {
    let resolve!: () => void
    mocks.write.mockReturnValue(new Promise<void>((done) => (resolve = done)))
    const clipboard = scope.run(useClipboard)!
    const pending = clipboard.copy("config")
    expect(clipboard.copying.value).toBe(true)
    expect(clipboard.copied.value).toBe(false)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(await clipboard.copy("config")).toBe(false)
    expect(mocks.write).toHaveBeenCalledTimes(1)
    resolve()
    expect(await pending).toBe(true)
    expect(clipboard.copied.value).toBe(true)
    expect(mocks.success).toHaveBeenCalledWith("state.copied_to_clipboard")
  })
  it("reports failure without showing a copied state", async () => {
    mocks.write.mockRejectedValueOnce(new Error("Permission denied"))
    const clipboard = scope.run(useClipboard)!
    expect(await clipboard.copy("secret")).toBe(false)
    expect(clipboard.copied.value).toBe(false)
    expect(clipboard.copying.value).toBe(false)
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith("error.copy_failed")
  })
})
