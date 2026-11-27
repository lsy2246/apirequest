import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createApp,
  defineComponent,
  h,
  nextTick,
  reactive,
  type App,
} from "vue"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import type { HoppRequestDocument } from "~/helpers/tab/document"
import {
  requestWithLatestRESTResponse,
  LATEST_RESPONSE_NAME,
} from "~/helpers/tab/saved-response"
import Response from "../Response.vue"

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock("~/newstore/collections", () => ({ editRESTRequest: mocks.save }))
vi.mock("~/composables/toast", () => ({ useToast: () => mocks }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/helpers/actions", () => ({ invokeAction: vi.fn() }))
let app: App
let target: HTMLElement
let doc: HoppRequestDocument
beforeEach(() => vi.resetAllMocks())
afterEach(() => app?.unmount())
async function mount(type: "success" | "fail" = "success") {
  const request = { ...getDefaultRESTRequest(), name: "Example" }
  doc = reactive({
    type: "request",
    request,
    isDirty: false,
    saveContext: {
      originLocation: "user-collection",
      folderPath: "0",
      requestIndex: 0,
    },
    response: {
      type,
      req: request,
      headers: [],
      body: new TextEncoder().encode('{"ok":false}').buffer,
      statusCode: type === "success" ? 200 : 500,
      statusText: type === "success" ? "OK" : "Server Error",
      meta: { responseSize: 12, responseDuration: 10 },
    },
  }) as HoppRequestDocument
  target = document.createElement("div")
  app = createApp(Response, { document: doc, tabId: "test", isEmbed: false })
  app.component("HttpResponseMeta", { render: () => null })
  app.component(
    "LensesResponseBodyRenderer",
    defineComponent({
      emits: ["save-as-example"],
      setup:
        (_, { emit }) =>
        () =>
          h(
            "button",
            { id: "open", onClick: () => emit("save-as-example") },
            "Save"
          ),
    })
  )
  app.component(
    "HttpSaveResponseName",
    defineComponent({
      props: ["show", "responseName", "hasSameNameResponse"],
      emits: ["submit"],
      setup:
        (props, { emit }) =>
        () =>
          props.show
            ? h(
                "section",
                {
                  id: "dialog",
                  "data-duplicate": String(props.hasSameNameResponse),
                },
                [
                  h("input", { value: props.responseName }),
                  h(
                    "button",
                    { id: "submit", onClick: () => emit("submit") },
                    "Submit"
                  ),
                ]
              )
            : null,
    })
  )
  app.mount(target)
  target.querySelector<HTMLButtonElement>("#open")!.click()
  await nextTick()
}
const submit = async () => {
  target.querySelector<HTMLButtonElement>("#submit")!.click()
  await nextTick()
}
describe("response example failure recovery", () => {
  it("keeps the name without creating a phantom example on failed save, then retries", async () => {
    await mount()
    mocks.save.mockImplementationOnce(() => {
      throw new Error("Save failed")
    })
    await submit()
    expect(mocks.error).toHaveBeenCalledWith("ui_detail.save_failed")
    expect(target.querySelector<HTMLInputElement>("input")?.value).toBe(
      "Example"
    )
    expect(
      target.querySelector("#dialog")?.getAttribute("data-duplicate")
    ).toBe("false")
    expect(doc.request.responses.Example).toBeUndefined()
    await submit()
    expect(target.querySelector("#dialog")).toBeNull()
    expect(doc.request.responses.Example.body).toBe('{"ok":false}')
    expect(mocks.success).toHaveBeenCalledOnce()
  })
  it("saves an HTTP error response with its status and body", async () => {
    await mount("fail")
    await submit()
    expect(mocks.save).toHaveBeenCalledWith(
      "0",
      0,
      expect.objectContaining({
        responses: {
          Example: expect.objectContaining({ code: 500, body: '{"ok":false}' }),
        },
      })
    )
  })
  it("retains the dialog if the request loses its save location", async () => {
    await mount()
    doc.saveContext = undefined
    await submit()
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith("ui_detail.save_failed")
    expect(target.querySelector("#dialog")).not.toBeNull()
  })
  it("includes HTTP error responses in the automatic latest-response example", async () => {
    await mount("fail")
    expect(
      requestWithLatestRESTResponse(doc).responses[LATEST_RESPONSE_NAME]
    ).toMatchObject({ code: 500, body: '{"ok":false}' })
  })
})
