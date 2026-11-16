import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { effectScope, type EffectScope } from "vue"

const notifications = vi.hoisted(() => ({
  success: vi.fn(),
  dismiss: vi.fn(),
}))
vi.mock("@apirequest/ui", () => ({ toast: notifications }))
vi.mock("../i18n", () => ({ useI18n: () => (key: string) => key }))

import { useUndoToast } from "../undo-toast"

describe("editor deletion undo", () => {
  let scope: EffectScope
  let showUndo: ReturnType<typeof useUndoToast>

  beforeEach(() => {
    vi.resetAllMocks()
    notifications.success.mockReturnValue("current")
    scope = effectScope()
    showUndo = scope.run(useUndoToast)!
  })
  afterEach(() => scope.stop())

  it("restores deleted rows and closes the notification only once", () => {
    const original = [{ key: "Authorization", value: "Bearer token" }]
    let rows: typeof original = []
    const restore = vi.fn(() => {
      rows = original
    })
    const dismiss = vi.fn()
    showUndo(restore)
    const { action } = notifications.success.mock.calls[0][1]
    expect(action.label).toBe("action.undo")
    action.onClick(new MouseEvent("click"), { dismiss })
    action.onClick(new MouseEvent("click"), { dismiss })
    expect(rows).toEqual(original)
    expect(restore).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it("replaces the previous undo and ignores its delayed completion", () => {
    notifications.success.mockReturnValueOnce(0).mockReturnValueOnce("latest")
    const first = vi.fn()
    const latest = vi.fn()
    showUndo(first)
    const firstOptions = notifications.success.mock.calls[0][1]
    showUndo(latest)
    expect(notifications.dismiss).toHaveBeenCalledWith(0)
    firstOptions.onDismiss({ id: 0 })
    firstOptions.onAutoClose({ id: 0 })
    firstOptions.action.onClick(new MouseEvent("click"), { dismiss: vi.fn() })
    const latestOptions = notifications.success.mock.calls[1][1]
    latestOptions.action.onClick(new MouseEvent("click"), { dismiss: vi.fn() })
    expect(first).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledOnce()
  })

  it.each(["onDismiss", "onAutoClose"])(
    "expires the undo on %s",
    (callback) => {
      const restore = vi.fn()
      showUndo(restore)
      const options = notifications.success.mock.calls[0][1]
      options[callback]({ id: "current" })
      options.action.onClick(new MouseEvent("click"), { dismiss: vi.fn() })
      expect(restore).not.toHaveBeenCalled()
      scope.stop()
      expect(notifications.dismiss).not.toHaveBeenCalled()
    }
  )

  it("disposes only this editor's notification when the editor closes", () => {
    const restore = vi.fn()
    showUndo(restore)
    scope.stop()
    expect(notifications.dismiss).toHaveBeenCalledExactlyOnceWith("current")
    const { action } = notifications.success.mock.calls[0][1]
    action.onClick(new MouseEvent("click"), { dismiss: vi.fn() })
    expect(restore).not.toHaveBeenCalled()
  })
})
