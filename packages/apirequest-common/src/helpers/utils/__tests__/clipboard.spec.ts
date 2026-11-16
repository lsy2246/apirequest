import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { copyToClipboard } from "../clipboard"

const mocks = vi.hoisted(() => ({
  platform: { localDesktop: false },
  native: vi.fn(),
  write: vi.fn(),
}))
vi.mock("~/platform", () => ({ platform: mocks.platform }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native }))

beforeEach(() => {
  mocks.platform.localDesktop = false
  vi.clearAllMocks()
  vi.stubGlobal("navigator", { clipboard: { writeText: mocks.write } })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe("clipboard writes", () => {
  it("waits for the browser write and propagates permission failures", async () => {
    let reject!: (error: Error) => void
    mocks.write.mockReturnValue(
      new Promise((_resolve, fail) => (reject = fail))
    )
    const result = copyToClipboard("config")
    const rejected = expect(result).rejects.toThrow("Permission denied")
    reject(new Error("Permission denied"))
    await rejected
  })

  it("uses desktop IPC and propagates native failures", async () => {
    mocks.platform.localDesktop = true
    mocks.native.mockRejectedValueOnce(new Error("Clipboard busy"))
    await expect(copyToClipboard("config")).rejects.toThrow("Clipboard busy")
    expect(mocks.native).toHaveBeenCalledWith("workbench_copy_text", {
      text: "config",
    })
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    "checks the legacy write result %s and restores focus",
    async (success) => {
      vi.stubGlobal("navigator", {})
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: vi.fn(() => success),
      })
      const input = document.createElement("input")
      document.body.appendChild(input)
      input.focus()
      const result = copyToClipboard("text")
      if (success) await expect(result).resolves.toBeUndefined()
      else await expect(result).rejects.toThrow("Clipboard unavailable")
      expect(document.activeElement).toBe(input)
      expect(document.querySelector("textarea")).toBeNull()
    }
  )
})
