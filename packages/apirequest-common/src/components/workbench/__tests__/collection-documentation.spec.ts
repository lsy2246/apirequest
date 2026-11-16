/* eslint-disable vue/one-component-per-file */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import { makeCollection } from "@apirequest/data"
import CollectionLauncher from "../CollectionLauncher.vue"

const state = vi.hoisted(() => ({ entries: undefined as any }))

vi.mock("~/composables/workbenchCollections", () => ({
  useWorkbenchCollections: () => ({ entries: state.entries }),
}))
vi.mock("~/composables/documentationVisibility", () => ({
  useDocumentationVisibility: () => ({ isDocumentationVisible: ref(true) }),
}))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("~/helpers/workbench", () => ({ openWorkbenchCurlImport: vi.fn() }))
vi.mock("~/helpers/actions", () => ({ invokeAction: vi.fn() }))
vi.mock("~/components/workbench/Page.vue", () => ({
  default: {
    setup:
      (_: unknown, { slots }: any) =>
      () =>
        h("div", slots.default?.()),
  },
}))

let app: App | undefined
afterEach(() => app?.unmount())

describe("collection documentation selection", () => {
  it("follows the synchronized collection when its database ID and path change", async () => {
    const collection = makeCollection({
      name: "Documentation",
      folders: [],
      requests: [],
      _ref_id: "coll_stable_reference",
      auth: { authType: "inherit", authActive: true },
      headers: [],
      variables: [],
    })
    state.entries = ref([{ path: "0", title: collection.name, collection }])
    const el = document.createElement("div")
    app = createApp(CollectionLauncher)
    const Button = defineComponent({
      props: { label: { type: String, default: "" } },
      setup: (props) => () => h("button", props.label),
    })
    app.component("HoppButtonSecondary", Button)
    app.component("HoppButtonPrimary", Button)
    app.component("HoppSmartToggle", () => null)
    app.component(
      "CollectionsDocumentation",
      defineComponent({
        props: {
          collectionID: { type: String, default: "" },
          pathOrID: { type: String, default: "" },
        },
        setup: (props) => () =>
          h("output", `${props.collectionID}:${props.pathOrID}`),
      })
    )
    app.mount(el)
    el.querySelector("article button")!.dispatchEvent(new MouseEvent("click"))
    await nextTick()
    expect(el.querySelector("output")?.textContent).toBe(
      "coll_stable_reference:0"
    )

    state.entries.value = [
      {
        path: "2/1",
        title: collection.name,
        collection: { ...collection, id: "database-collection-id" },
      },
    ]
    await nextTick()
    expect(el.querySelector("output")?.textContent).toBe(
      "database-collection-id:2/1"
    )

    state.entries.value = []
    await nextTick()
    expect(el.querySelector("output")).toBeNull()
  })
})
