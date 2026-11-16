import { createApp, h, nextTick, type VNode } from "vue"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Select from "../Select.vue"

const cleanups: (() => void)[] = []
function mountFixture(render: () => VNode) {
  const target = document.createElement("div")
  document.body.append(target)
  const app = createApp({ render })
  app.mount(target)
  cleanups.push(() => {
    app.unmount()
    target.remove()
  })
  return target
}
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  vi.unstubAllGlobals()
})

describe("workspace select integration", () => {
  it("preserves the empty-string option used by capture filters", async () => {
    const update = vi.fn()
    const target = mountFixture(() =>
      h(Select, {
        modelValue: "",
        label: "Filter",
        options: [
          { value: "", label: "All" },
          { value: "GET", label: "GET" },
        ],
        "onUpdate:modelValue": update,
      })
    )
    const trigger = target.querySelector<HTMLButtonElement>("button")!
    expect(trigger.textContent).toContain("All")
    trigger.focus()
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const selected = document.body.querySelector<HTMLElement>(
      '[role="option"][data-state="checked"]'
    )!
    expect(selected.textContent).toContain("All")
    const get = [
      ...document.body.querySelectorAll<HTMLElement>('[role="option"]'),
    ].find((e) => e.textContent?.includes("GET"))!
    get.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
    )
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith("GET"))
  })

  it("honors a containing disabled fieldset", async () => {
    const target = mountFixture(() =>
      h("fieldset", { disabled: true }, [
        h(Select, {
          modelValue: "GET",
          label: "Method",
          options: [{ value: "GET", label: "GET" }],
        }),
      ])
    )
    const trigger = target.querySelector<HTMLButtonElement>("button")!
    expect(trigger.matches(":disabled")).toBe(true)
    trigger.click()
    await nextTick()
    expect(trigger.getAttribute("aria-expanded")).toBe("false")
  })

  it("closes the menu before an existing document-level modal handler", async () => {
    const modalEscape = vi.fn()
    document.addEventListener("keydown", modalEscape)
    cleanups.push(() => document.removeEventListener("keydown", modalEscape))
    const target = mountFixture(() =>
      h(Select, {
        modelValue: "GET",
        label: "Method",
        options: [{ value: "GET", label: "GET" }],
      })
    )
    const trigger = target.querySelector<HTMLButtonElement>("button")!
    trigger.focus()
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
    )
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("true")
    )
    modalEscape.mockClear()
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
    await vi.waitFor(() =>
      expect(trigger.getAttribute("aria-expanded")).toBe("false")
    )
    expect(modalEscape).not.toHaveBeenCalled()
  })
})
