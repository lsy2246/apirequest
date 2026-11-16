import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import AIAccess from "../ai-access.vue"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  write: vi.fn(),
  native: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  platform: { localDesktop: false },
  refresh: undefined as undefined | (() => Promise<void>),
}))
vi.mock("~/platform", () => ({ platform: mocks.platform }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/toast", () => ({ useToast: () => mocks }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native }))
vi.mock("~/helpers/workbench-mcp", () => ({ workbenchMcpAPI: mocks.api }))
vi.mock("~/composables/workbenchLive", () => ({
  provideWorkbenchLive: () => ({}),
  useWorkbenchLiveQuery: (_: unknown, load: () => Promise<void>) => {
    mocks.refresh = load
    return { invalidate: vi.fn() }
  },
}))
vi.mock("~/components/workbench/SavedPlans.vue", () => ({
  default: { render: () => null },
}))
vi.mock("~/components/workbench/Select.vue", () => ({
  default: { render: () => null },
}))

let app: App | undefined
let target: HTMLElement
const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard")
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  mocks.platform.localDesktop = false
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.write },
  })
  mocks.api.mockImplementation(async (path: string) =>
    path === "access"
      ? {
          mcpServers: {
            apirequest: mocks.platform.localDesktop
              ? {
                  url: "http://127.0.0.1:1234/mcp",
                  headers: { Authorization: "Bearer test" },
                }
              : { command: "node", args: [], env: { TOKEN: "test" } },
          },
        }
      : { enabled: false, approvalRequired: true, proposals: [], guide: {} }
  )
})
afterEach(() => {
  app?.unmount()
  vi.useRealTimers()
  if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor)
  else Reflect.deleteProperty(navigator, "clipboard")
})

async function mount() {
  target = document.createElement("div")
  app = createApp(AIAccess)
  for (const name of ["HoppButtonPrimary", "HoppButtonSecondary"])
    app.component(
      name,
      defineComponent({
        props: ["label", "disabled", "loading"],
        setup: (props) => () =>
          h("button", { disabled: props.disabled }, props.label),
      })
    )
  app.component("HoppSmartConfirmModal", { render: () => null })
  app.component("HoppSmartSpinner", { render: () => null })
  app.mount(target)
  await mocks.refresh!()
  await nextTick()
  button("workbench_mcp.enable").click()
  await vi.waitFor(() => expect(target.textContent).toContain("action.copy"))
}
function button(label: string) {
  return Array.from(target.querySelectorAll("button")).find(
    (item) => item.textContent === label
  )!
}

describe("MCP connection copy", () => {
  it("waits for the web clipboard before showing success", async () => {
    let complete!: () => void
    mocks.write.mockReturnValueOnce(
      new Promise<void>((resolve) => (complete = resolve))
    )
    await mount()
    button("action.copy").click()
    await nextTick()
    expect(button("action.copy").disabled).toBe(true)
    expect(mocks.success).not.toHaveBeenCalled()
    complete()
    await vi.waitFor(() => expect(target.textContent).toContain("state.copied"))
    expect(mocks.write).toHaveBeenCalledWith(
      expect.stringContaining("[mcp_servers.apirequest]")
    )
    expect(mocks.success).toHaveBeenCalledWith("state.copied_to_clipboard")
  })
  it("shows a failure when the native clipboard rejects the configuration", async () => {
    mocks.platform.localDesktop = true
    mocks.native.mockRejectedValueOnce(new Error("Clipboard unavailable"))
    await mount()
    button("action.copy").click()
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("error.copy_failed")
    )
    expect(mocks.native).toHaveBeenCalledWith("workbench_copy_text", {
      text: expect.stringContaining("http_headers"),
    })
    expect(mocks.success).not.toHaveBeenCalled()
    expect(button("action.copy").disabled).toBe(false)
  })
})
