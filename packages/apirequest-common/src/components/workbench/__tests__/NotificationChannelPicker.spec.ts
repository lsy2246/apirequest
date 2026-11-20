/* eslint-disable vue/one-component-per-file -- The harness supplies v-model to the real picker. */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, ref, type App } from "vue"
import Picker from "../NotificationChannelPicker.vue"
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("~/helpers/workbench-mcp", () => ({ workbenchMcpAPI: mocks.api }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
let app: App | undefined
const rows = [
  { id: "old", name: "Old bot", format: "feishu", legacy: true, enabled: true },
  { id: "new", name: "New webhook", format: "json", enabled: true },
  { id: "paused", name: "Paused", format: "json", enabled: false },
]
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
async function mount(initial?: string[]) {
  const selected = ref(initial),
    picker = ref<{ validate: () => Promise<boolean> }>()
  const el = document.createElement("div")
  app = createApp(
    defineComponent({
      setup: () => () =>
        h(Picker, {
          ref: picker,
          modelValue: selected.value,
          "onUpdate:modelValue": (ids: string[]) => (selected.value = ids),
        }),
    })
  )
  app.component(
    "HoppButtonSecondary",
    defineComponent({
      props: { label: { type: String, default: "" } },
      setup: (props) => () => h("button", props.label),
    })
  )
  app.mount(el)
  await settle()
  return { el, selected, picker }
}
afterEach(() => {
  app?.unmount()
  vi.clearAllMocks()
})
describe("automation notification channel selection", () => {
  it("preserves only the legacy channel by default and supports selecting more recipients", async () => {
    mocks.api.mockResolvedValue(rows)
    const { el, selected, picker } = await mount()
    expect(selected.value).toEqual(["old"])
    const checkbox = el.querySelector<HTMLInputElement>(
      'input[aria-label="New webhook"]'
    )!
    checkbox.checked = true
    checkbox.dispatchEvent(new Event("change"))
    await settle()
    expect(selected.value).toEqual(["old", "new"])
    expect(await picker.value!.validate()).toBe(true)
    expect(
      el.querySelector<HTMLInputElement>('input[aria-label="Paused"]')!.disabled
    ).toBe(true)
  })
  it("does not silently replace an empty selection with a default recipient", async () => {
    mocks.api.mockResolvedValue(rows)
    const { selected, picker } = await mount([])
    expect(selected.value).toEqual([])
    expect(await picker.value!.validate()).toBe(false)
  })
  it("fails validation when a selected channel is missing or loading fails", async () => {
    mocks.api.mockResolvedValue(rows)
    const { el, picker } = await mount(["deleted"])
    expect(el.textContent).toContain("automation_webhook.missing_channels")
    expect(await picker.value!.validate()).toBe(false)
    app?.unmount()
    mocks.api.mockRejectedValue(new Error("offline"))
    const failed = await mount()
    expect(failed.el.textContent).toContain("offline")
    expect(await failed.picker.value!.validate()).toBe(false)
  })
})
