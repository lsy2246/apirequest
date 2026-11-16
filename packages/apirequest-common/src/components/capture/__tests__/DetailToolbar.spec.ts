import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, h, nextTick, ref, type App, type Ref } from "vue"
import DetailToolbar from "../DetailToolbar.vue"

const viewport = vi.hoisted(() => ({
  width: undefined as Ref<number> | undefined,
}))
vi.mock("@vueuse/core", async (original) => {
  const actual = await original<typeof import("@vueuse/core")>()
  const { ref } = await import("vue")
  viewport.width = ref(900)
  return {
    ...actual,
    useElementSize: () => ({ width: viewport.width!, height: ref(48) }),
  }
})
const labels: Record<string, string> = {
  "workbench_capture.open_request": "Open request",
  "workbench_capture.replay": "Replay",
  "workbench_capture.copy_curl": "Copy cURL",
  "workbench_capture.export_har": "Export HAR",
  "workbench_capture.mark_compare": "Set baseline",
  "workbench_capture.clear_compare": "Clear baseline",
  "workbench_capture.baseline": "Baseline",
  "workbench_capture.close_detail": "Close details",
  "action.more": "More",
}
vi.mock("~/composables/i18n", () => ({
  useI18n: () => (key: string) => labels[key] ?? key,
}))
const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView"
)
let app: App | undefined
let target: HTMLDivElement
const fixture = {
  id: "request-a",
  method: "GET",
  status: 200,
  url: "https://example.test/long/request?name=fixture",
}
function mount(overrides = {}) {
  target = document.createElement("div")
  document.body.append(target)
  const props = ref({
    detail: fixture,
    canOpen: true,
    canReplay: true,
    busy: false,
    ...overrides,
  })
  const events = {
    onOpenRequest: vi.fn(),
    onReplay: vi.fn(),
    onCopyCurl: vi.fn(),
    onDownloadHar: vi.fn(),
    onMarkComparison: vi.fn(),
    onClearComparison: vi.fn(),
    onClose: vi.fn(),
  }
  app = createApp({
    render: () => h(DetailToolbar, { ...props.value, ...events }),
  })
  app.mount(target)
  return { props, events }
}
async function openMenu() {
  const trigger = target.querySelector<HTMLButtonElement>(
    'button[aria-label="More"]'
  )!
  trigger.focus()
  trigger.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })
  )
  await vi.waitFor(() =>
    expect(
      document.body.querySelector('[role="menu"][data-state="open"]')
    ).not.toBeNull()
  )
  return document.body.querySelector<HTMLElement>(
    '[role="menu"][data-state="open"]'
  )!
}
function item(menu: HTMLElement, label: string) {
  return Array.from(
    menu.querySelectorAll<HTMLElement>('[role="menuitem"]')
  ).find((element) => element.textContent?.trim() === label)!
}
beforeEach(() => {
  viewport.width!.value = 900
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  app?.unmount()
  target?.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalScrollIntoView)
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      originalScrollIntoView
    )
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
})
describe("capture request detail toolbar", () => {
  it("keeps primary actions in the header and moves copy/export into the menu", async () => {
    const { events } = mount()
    expect(target.textContent?.replace(/\s/g, "")).toContain("GET200")
    expect(
      target.querySelector(
        '[title="https://example.test/long/request?name=fixture"]'
      )
    ).not.toBeNull()
    const buttons = Array.from(
      target.querySelectorAll<HTMLButtonElement>("button")
    )
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      "Open request",
      "Replay",
      "",
      "",
    ])
    expect(target.textContent).not.toContain("Compare with baseline")
    buttons[0].click()
    expect(events.onOpenRequest).toHaveBeenCalledOnce()
    const menu = await openMenu()
    expect(item(menu, "Replay")).toBeUndefined()
    item(menu, "Copy cURL").click()
    await nextTick()
    expect(events.onCopyCurl).toHaveBeenCalledOnce()
    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="menu"]')).toBeNull()
    )
  })
  it("moves replay into the menu for a narrow detail pane and preserves export", async () => {
    viewport.width!.value = 360
    const { events } = mount()
    expect(target.textContent).not.toContain("Replay")
    let menu = await openMenu()
    item(menu, "Replay").click()
    await nextTick()
    expect(events.onReplay).toHaveBeenCalledOnce()
    menu = await openMenu()
    item(menu, "Export HAR").click()
    await nextTick()
    expect(events.onDownloadHar).toHaveBeenCalledOnce()
  })
  it.each([360, 900])(
    "keeps baseline controls without a duplicate comparison action at width %i",
    async (width) => {
      viewport.width!.value = width
      const { props, events } = mount({ comparison: { id: fixture.id } })
      expect(target.querySelector(".capture-baseline")?.textContent).toBe(
        "Baseline"
      )
      expect(target.textContent).not.toContain("Compare with baseline")
      let menu = await openMenu()
      item(menu, "Clear baseline").click()
      await nextTick()
      expect(events.onClearComparison).toHaveBeenCalledOnce()
      menu = await openMenu()
      props.value.detail = { ...fixture, id: "request-b" }
      await nextTick()
      await vi.waitFor(() =>
        expect(document.body.querySelector('[role="menu"]')).toBeNull()
      )
      expect(target.querySelector(".capture-baseline")).toBeNull()
      expect(target.textContent).not.toContain("Compare with baseline")
      menu = await openMenu()
      expect(item(menu, "Set baseline")).toBeDefined()
      expect(item(menu, "Compare with baseline")).toBeUndefined()
    }
  )
  it("keeps unavailable actions disabled and lets Escape dismiss only the menu", async () => {
    const { events } = mount({ canOpen: false, canReplay: false })
    expect(
      target.querySelector<HTMLButtonElement>(".capture-open-request")!.disabled
    ).toBe(true)
    const menu = await openMenu()
    expect(item(menu, "Copy cURL").getAttribute("aria-disabled")).toBe("true")
    expect(item(menu, "Replay")).toBeUndefined()
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    )
    await nextTick()
    await vi.waitFor(() =>
      expect(document.body.querySelector('[role="menu"]')).toBeNull()
    )
    expect(events.onClose).not.toHaveBeenCalled()
    target
      .querySelector<HTMLButtonElement>('button[aria-label="Close details"]')!
      .click()
    expect(events.onClose).toHaveBeenCalledOnce()
  })
})
