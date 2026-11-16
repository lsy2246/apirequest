import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, type App } from "vue"
import { getDefaultRESTRequest } from "@apirequest/data"
import { invokeAction, isActionBound } from "~/helpers/actions"
import ActionHandler from "../ActionHandler.vue"

const mocks = vi.hoisted(() => ({
  platform: { localDesktop: false, auth: { performAuthInit: vi.fn() } },
  curl: vi.fn(),
  native: vi.fn(),
  clipboard: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock("~/platform", () => ({ platform: mocks.platform }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/toast", () => ({ useToast: () => mocks.toast }))
vi.mock("~/helpers/request-as-curl", () => ({ requestAsCurl: mocks.curl }))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.native }))

let app: App | undefined
const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard"
)

function mount() {
  app = createApp(ActionHandler)
  app.component("AppShortcuts", () => null)
  app.component("HttpResponseInterface", () => null)
  app.mount(document.createElement("div"))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.platform.localDesktop = false
  mocks.curl.mockResolvedValue("curl 'https://example.test'")
  mocks.clipboard.mockResolvedValue(undefined)
  mocks.native.mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.clipboard },
  })
})

afterEach(() => {
  app?.unmount()
  app = undefined
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor)
  else Reflect.deleteProperty(navigator, "clipboard")
})

describe("workspace request copy action", () => {
  it("copies without mounting the retired share sidebar and releases its action on unmount", async () => {
    mount()
    invokeAction("share.request", { request: getDefaultRESTRequest() })

    await vi.waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        "state.copied_to_clipboard"
      )
    )
    expect(mocks.clipboard).toHaveBeenCalledWith("curl 'https://example.test'")
    expect(mocks.native).not.toHaveBeenCalled()
    app!.unmount()
    app = undefined
    expect(isActionBound("share.request").value).toBe(false)
  })

  it("uses the native clipboard and retains the credential warning", async () => {
    mocks.platform.localDesktop = true
    mount()
    invokeAction("share.request", {
      request: {
        ...getDefaultRESTRequest(),
        auth: { authType: "bearer", authActive: true, token: "secret" },
      },
    })

    await vi.waitFor(() =>
      expect(mocks.toast.info).toHaveBeenCalledWith(
        "shared_requests.auth_warning"
      )
    )
    expect(mocks.native).toHaveBeenCalledWith("workbench_copy_curl", {
      text: "curl 'https://example.test'",
    })
    expect(mocks.clipboard).not.toHaveBeenCalled()
  })

  it("reports generation failure without replacing the clipboard", async () => {
    mocks.curl.mockRejectedValueOnce(new Error("Request unavailable"))
    mount()
    invokeAction("share.request", { request: getDefaultRESTRequest() })

    await vi.waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith("error.copy_failed")
    )
    expect(mocks.clipboard).not.toHaveBeenCalled()
    expect(mocks.native).not.toHaveBeenCalled()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})
