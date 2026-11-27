import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, type App } from "vue"
import PublishedDocument from "../_id/_version.vue"

// The application router consumes route metadata; this component test does not.
vi.mock("../_id/_version.vue?vue&type=route&index=0&lang.yaml", () => ({ default: () => {} }))
const mocks = vi.hoisted(() => ({ load: vi.fn(), convert: vi.fn() }))
vi.mock("~/helpers/backend/queries/PublishedDocs", () => ({
  getPublishedDocBySlugREST: () => mocks.load,
  collectionFolderToHoppCollection: mocks.convert,
}))
vi.mock("vue-router", () => ({
  useRoute: () => ({ params: { id: "audit", version: "v1" } }),
}))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/head", () => ({ usePageHead: vi.fn() }))
vi.mock("~/platform", () => ({ platform: {} }))
let app: App
let target: HTMLElement
beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => {})
  mocks.convert.mockReturnValue({
    name: "Recovered",
    auth: { authType: "none", authActive: true },
    headers: [],
    variables: [],
    folders: [],
    requests: [],
  })
})
afterEach(() => {
  app?.unmount()
  vi.restoreAllMocks()
})
function mount() {
  target = document.createElement("div")
  app = createApp(PublishedDocument)
  app.component("DocumentationSkeleton", {
    render: () => h("span", { id: "loading" }, "Loading"),
  })
  app.component("DocumentationHeader", { render: () => null })
  app.component("DocumentationContent", {
    render: () => h("section", { id: "content" }, "Loaded"),
  })
  app.component(
    "HoppButtonSecondary",
    defineComponent({
      props: ["label"],
      setup: (props) => () => h("button", props.label),
    })
  )
  app.mount(target)
}
describe("public document page failure recovery", () => {
  it("releases loading for malformed document content and recovers on retry", async () => {
    mocks.load.mockResolvedValueOnce({
      _tag: "Right",
      right: { documentTree: "{invalid" },
    })
    mocks.load.mockResolvedValueOnce({
      _tag: "Right",
      right: { documentTree: "{}" },
    })
    mount()
    await vi.waitFor(() =>
      expect(target.querySelector("button")?.textContent).toBe("action.retry")
    )
    expect(target.querySelector("#loading")).toBeNull()
    expect(target.textContent).toContain("workbench.load_failed_description")
    target.querySelector("button")!.click()
    await vi.waitFor(() =>
      expect(target.querySelector("#content")).not.toBeNull()
    )
    expect(target.querySelector("button")).toBeNull()
  })
  it.each(["not_found", "unauthorized"])(
    "does not suggest a transient retry for %s",
    async (reason) => {
      mocks.load.mockResolvedValue({
        _tag: "Left",
        left: `published_docs/${reason}`,
      })
      mount()
      await vi.waitFor(() =>
        expect(target.querySelector("#loading")).toBeNull()
      )
      expect(target.textContent).toContain(
        reason === "not_found"
          ? "documentation.publish.not_found"
          : "profile.no_permission"
      )
      expect(target.querySelector("button")).toBeNull()
    }
  )
})
