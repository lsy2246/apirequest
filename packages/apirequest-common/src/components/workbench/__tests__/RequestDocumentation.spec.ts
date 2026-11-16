/* eslint-disable vue/one-component-per-file */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { getDefaultRESTRequest } from "@apirequest/data"
import RequestDocumentation from "../RequestDocumentation.vue"
import RequestPreview from "~/components/collections/documentation/RequestPreview.vue"
import MarkdownEditor from "~/components/collections/documentation/MarkdownEditor.vue"
import { mergeCurlRequest } from "~/helpers/curl/merge-request"
import { invokeAction } from "~/helpers/actions"

const services = vi.hoisted(() => ({
  setRequestDocumentation: vi.fn(),
  createNewTab: vi.fn(),
  getEnvironmentByKey: vi.fn(),
}))
vi.mock("dioc/vue", () => ({ useService: () => services }))
vi.mock("~/services/tab/workspace-tabs", () => ({
  WorkspaceTabsService: class {},
}))
vi.mock("~/services/team-collection.service", () => ({
  TeamCollectionsService: class {},
}))
vi.mock("~/services/documentation.service", () => ({
  DocumentationService: class {},
}))
vi.mock("~/services/current-environment-value.service", () => ({
  CurrentValueService: class {},
}))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/toast", () => ({
  useToast: () => ({ success: vi.fn() }),
}))
vi.mock("~/platform", () => ({ platform: {} }))
vi.mock("~/helpers/actions", () => ({ invokeAction: vi.fn() }))
vi.mock("~/newstore/collections", () => ({
  cascadeParentCollectionForProperties: vi.fn(),
}))
vi.mock("~/newstore/environments", () => ({
  getCurrentEnvironment: () => ({ id: "env" }),
}))
vi.mock("~/helpers/utils/EffectiveURL", () => ({
  getEffectiveRESTRequest: async (request: { endpoint: string }) => ({
    effectiveFinalURL: request.endpoint,
  }),
}))

let app: App | undefined
afterEach(() => {
  app?.unmount()
  vi.clearAllMocks()
})

describe("request documentation in the editor", () => {
  it("edits the request draft, follows cURL updates, and returns to the same debug tab", async () => {
    const request = ref({
      ...getDefaultRESTRequest(),
      endpoint: "https://example.com/users",
      description: "Original documentation",
    })
    const debug = vi.fn()
    const target = document.createElement("div")
    app = createApp({
      render: () =>
        h(RequestDocumentation, {
          modelValue: request.value,
          environmentVariables: [],
          "onUpdate:modelValue": (value) => {
            request.value = value
          },
          onDebug: debug,
        }),
    })
    app.component("CollectionsDocumentationRequestPreview", RequestPreview)
    app.component("CollectionsDocumentationMarkdownEditor", MarkdownEditor)
    app.component(
      "CollectionsDocumentationSectionsCurlView",
      defineComponent({
        props: ["request"],
        setup: (props) => () =>
          h("pre", { class: "curl" }, props.request.endpoint),
      })
    )
    app.component(
      "HoppButtonSecondary",
      defineComponent({
        props: ["label"],
        setup: (props) => () => h("button", props.label),
      })
    )
    app.component(
      "HoppSmartItem",
      defineComponent({
        setup: () => () => h("button", { class: "debug" }, "Debug"),
      })
    )
    for (const name of [
      "Auth",
      "Headers",
      "Parameters",
      "Variables",
      "RequestBody",
      "Response",
    ]) {
      app.component(
        `CollectionsDocumentationSections${name}`,
        defineComponent({
          setup: () => () => h("div"),
        })
      )
    }
    app.mount(target)
    await nextTick()

    target.querySelector<HTMLElement>(".markdown-content")!.click()
    await nextTick()
    const editor = target.querySelector<HTMLTextAreaElement>("textarea")!
    editor.value = "Updated documentation"
    editor.dispatchEvent(new Event("input"))
    editor.dispatchEvent(new Event("blur"))
    await nextTick()
    expect(request.value.description).toBe("Updated documentation")
    expect(services.setRequestDocumentation).not.toHaveBeenCalled()

    request.value = mergeCurlRequest(request.value, {
      ...getDefaultRESTRequest(),
      endpoint: "https://example.com/new-users",
      method: "POST",
    })
    await nextTick()
    expect(target.querySelector(".curl")!.textContent).toBe(
      "https://example.com/new-users"
    )
    expect(target.querySelector(".markdown-content")!.textContent).toContain(
      "Updated documentation"
    )

    target.querySelector<HTMLButtonElement>(".debug")!.click()
    expect(debug).toHaveBeenCalledOnce()
    expect(services.createNewTab).not.toHaveBeenCalled()
    target.querySelector<HTMLButtonElement>("button")!.click()
    expect(invokeAction).toHaveBeenCalledWith("request-response.save")
  })
})
