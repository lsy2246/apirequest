import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App } from "vue"
import RequestModes from "../RequestModes.vue"
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/documentationVisibility", () => ({
  useDocumentationVisibility: () => ({
    isDocumentationVisible: { value: true },
  }),
}))
let app: App
let target: HTMLElement
afterEach(() => {
  app?.unmount()
  target?.remove()
})
describe("request mode keyboard navigation", () => {
  it("activates adjacent and boundary tabs with one tab stop", async () => {
    const mode = ref("debug")
    target = document.createElement("div")
    document.body.append(target)
    app = createApp({
      setup: () => () =>
        h(RequestModes, {
          modelValue: mode.value as "debug",
          idPrefix: "request-1",
          "onUpdate:modelValue": (value: string) => {
            mode.value = value
          },
        }),
    })
    app.mount(target)
    const tabs = Array.from(target.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    tabs[0].focus()
    const press = async (key: string) => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      )
      await nextTick()
      expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1)
      expect(document.activeElement?.getAttribute("aria-selected")).toBe("true")
      expect(document.activeElement?.getAttribute("aria-controls")).toBe(
        "request-1-panel"
      )
    }
    await press("ArrowRight")
    expect(mode.value).toBe("design")
    await press("End")
    expect(mode.value).toBe("settings")
    await press("ArrowRight")
    expect(mode.value).toBe("debug")
    await press("ArrowLeft")
    expect(mode.value).toBe("settings")
    await press("Home")
    expect(mode.value).toBe("debug")
  })
})
