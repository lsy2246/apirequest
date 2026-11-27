import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, type App } from "vue"
import ResultDialog from "../ResultDialog.vue"

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetch: vi.fn() }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/helpers/native-workbench-history", () => ({
  downloadNativeHistory: vi.fn(),
}))
vi.mock("~/helpers/workbench-history-results", () => ({
  historyResultAPI: mocks.api,
  historyResultURL: (path: string) => `asset://localhost/${path}`,
  formatBytes: (size: string) => `${size} B`,
  pendingHistoryResults: new Map(),
}))

let app: App | undefined
function mount() {
  const target = document.createElement("div")
  app = createApp(ResultDialog, { historyId: "saved-result" })
  app.component(
    "HoppSmartModal",
    defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("div", slots.body?.()),
    })
  )
  app.component("HoppSmartSpinner", { render: () => h("span") })
  app.component("HoppButtonSecondary", {
    props: ["label"],
    setup: (props: { label?: string }) => () => h("button", props.label),
  })
  app.mount(target)
  return target
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", mocks.fetch)
  Object.assign(window, { __APIREQUEST_NATIVE__: false })
  mocks.api.mockResolvedValue({
    state: "saved",
    kind: "json",
    size: "17",
    metadata: {
      statusCode: 422,
      statusText: "Unprocessable Entity",
      contentType: "application/json",
      headers: [],
    },
    attachments: [],
    canAttach: false,
  })
  mocks.fetch.mockImplementation(async (_, options: RequestInit) => {
    // The native asset protocol allows reading files but does not return
    // Access-Control-Allow-Credentials, so WebViews reject this combination.
    if (window.__APIREQUEST_NATIVE__ && options.credentials === "include")
      throw new TypeError("Load failed")
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"message":"你好"}'))
          controller.close()
        },
      }),
    }
  })
})
afterEach(() => {
  app?.unmount()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(window, "__APIREQUEST_NATIVE__")
})

describe("history response preview", () => {
  it("reads native response files without credentials", async () => {
    Object.assign(window, { __APIREQUEST_NATIVE__: true })
    const target = mount()
    await vi.waitFor(() =>
      expect(target.querySelector("pre")?.textContent).toBe(
        '{"message":"你好"}'
      )
    )
    expect(target.querySelector('[role="alert"]')).toBeNull()
    expect(mocks.fetch).toHaveBeenCalledWith(
      "asset://localhost/saved-result/body",
      expect.objectContaining({ credentials: "omit" })
    )
  })

  it("keeps session credentials for the web response endpoint", async () => {
    const target = mount()
    await vi.waitFor(() => expect(target.querySelector("pre")).not.toBeNull())
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ credentials: "include" })
    )
  })

  it("reports an unreadable response while preserving its metadata", async () => {
    mocks.fetch.mockRejectedValueOnce(new TypeError("Load failed"))
    const target = mount()
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(
        "history_results.error"
      )
    )
    expect(target.textContent).toContain("422 Unprocessable Entity")
  })
  it("explains when a saved response body is gone", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 404 })
    const target = mount()
    await vi.waitFor(() =>
      expect(target.textContent).toContain("history_results.body_missing")
    )
    expect(target.textContent).toContain("422 Unprocessable Entity")
    expect(target.textContent).not.toContain("history_results.error")
    expect(target.textContent).not.toContain("action.download_file")
    expect(target.textContent).not.toContain("action.retry")
  })

  it("retries a failed detail load and clears the error", async () => {
    mocks.api.mockRejectedValueOnce(new Error("offline"))
    const target = mount()
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"]')).not.toBeNull()
    )
    const retry = target.querySelector(
      '[role="alert"] button'
    ) as HTMLButtonElement
    expect(retry.textContent).toBe("action.retry")
    retry.click()
    await vi.waitFor(() =>
      expect(target.querySelector("pre")?.textContent).toBe(
        '{"message":"你好"}'
      )
    )
    expect(mocks.api).toHaveBeenCalledTimes(2)
    expect(target.querySelector('[role="alert"]')).toBeNull()
    expect(target.querySelector('[aria-busy="true"]')).toBeNull()
  })

  it("retries a failed preview without refetching response metadata", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline"))
    const target = mount()
    await vi.waitFor(() =>
      expect(target.querySelector('[role="alert"] button')).not.toBeNull()
    )
    ;(
      target.querySelector('[role="alert"] button') as HTMLButtonElement
    ).click()
    await vi.waitFor(() =>
      expect(target.querySelector("pre")?.textContent).toBe(
        '{"message":"你好"}'
      )
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(mocks.api).toHaveBeenCalledTimes(1)
    expect(target.querySelector('[role="alert"]')).toBeNull()
    expect(target.textContent).toContain("422 Unprocessable Entity")
  })
})
