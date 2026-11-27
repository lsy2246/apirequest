import { afterEach, describe, expect, it, vi } from "vitest"
import { relativeTime, trapDialogTab } from "../ui-states"

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe("dialog keyboard focus", () => {
  it("cycles through visible enabled controls", () => {
    const dialog = document.createElement("section")
    dialog.tabIndex = -1
    dialog.innerHTML =
      '<button id="first">First</button><button disabled>Disabled</button><button id="last">Last</button><button hidden>Hidden</button>'
    document.body.append(dialog)
    dialog.addEventListener("keydown", trapDialogTab)
    const first = dialog.querySelector<HTMLButtonElement>("#first")!
    const last = dialog.querySelector<HTMLButtonElement>("#last")!
    for (const element of [first, last]) {
      vi.spyOn(element, "getClientRects").mockReturnValue([
        {},
      ] as unknown as DOMRectList)
    }
    dialog.focus()
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    expect(document.activeElement).toBe(last)
    last.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      })
    )
    expect(document.activeElement).toBe(first)
    first.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      })
    )
    expect(document.activeElement).toBe(last)
  })

  it("keeps focus in an empty dialog", () => {
    const dialog = document.createElement("section")
    dialog.tabIndex = -1
    document.body.append(dialog)
    dialog.addEventListener("keydown", trapDialogTab)
    const event = new KeyboardEvent("keydown", { key: "Tab", cancelable: true })
    dialog.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(dialog)
  })
})

it("formats history times in the selected language", () => {
  const now = new Date("2026-11-26T12:00:00Z")
  const earlier = new Date("2026-11-26T10:00:00Z")
  expect(relativeTime(earlier, now, "cn")).toBe("2小时前")
  expect(relativeTime(earlier, now, "en")).toBe("2 hours ago")
})
