import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, type App } from "vue"
import ColumnMenu from "../ColumnMenu.vue"

vi.mock("~/composables/i18n", () => ({
  useI18n: () => (key: string) => key,
}))
let app: App | undefined
let target: HTMLDivElement
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
  app?.unmount()
  target?.remove()
  vi.unstubAllGlobals()
})
async function mount(column = "responseSize") {
  target = document.createElement("div")
  document.body.append(target)
  const onFilter = vi.fn(),
    onSort = vi.fn()
  app = createApp({
    render: () =>
      h(ColumnMenu, {
        column,
        label: "Size",
        sorted: false,
        descending: true,
        onFilter,
        onSort,
      }),
  })
  app.mount(target)
  const trigger = target.querySelector<HTMLButtonElement>("button")!
  trigger.click()
  await vi.waitFor(() =>
    expect(document.body.querySelector(".capture-column-menu")).not.toBeNull()
  )
  return {
    trigger,
    onFilter,
    onSort,
    menu: document.body.querySelector<HTMLElement>(".capture-column-menu")!,
  }
}
function fill(input: HTMLInputElement, value: string) {
  input.value = value
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
describe("capture column menu", () => {
  it("closes on Escape and returns focus without applying a draft", async () => {
    const { trigger, menu, onFilter } = await mount("url")
    fill(menu.querySelector("input")!, "unsaved filter")
    await nextTick()
    menu.querySelector("input")!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      })
    )
    await vi.waitFor(() =>
      expect(document.body.querySelector(".capture-column-menu")).toBeNull()
    )
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(onFilter).not.toHaveBeenCalled()
  })
  it("rejects reversed bounds and sends KiB ranges as bytes on Apply", async () => {
    const { menu, onFilter } = await mount()
    const [min, max] = Array.from(
      menu.querySelectorAll<HTMLInputElement>('input[type="number"]')
    )
    const submit = () =>
      menu
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    fill(min, "3")
    fill(max, "2")
    await nextTick()
    submit()
    await nextTick()
    expect(menu.querySelector('[role="alert"]')).not.toBeNull()
    expect(onFilter).not.toHaveBeenCalled()
    fill(min, "0")
    fill(max, "1.5")
    await nextTick()
    submit()
    expect(onFilter).toHaveBeenCalledWith({ min: 0, max: 1536 })
  })
})
