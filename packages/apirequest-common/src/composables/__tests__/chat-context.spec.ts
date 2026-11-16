import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TestContainer } from "dioc/testing"
import { diocPlugin } from "dioc/vue"
import { BehaviorSubject } from "rxjs"
import { createApp, defineComponent, h, nextTick, type App } from "vue"

vi.mock("~/modules/i18n", () => ({
  getI18n: () => (key: string) => key,
  APP_LANGUAGES: [],
  changeAppLanguage: () => {},
}))

vi.mock("~/platform", () => ({
  platform: {
    experiments: { aiExperiments: {} },
    auth: {
      getCurrentUser: () => null,
      getCurrentUserStream: () => new BehaviorSubject(null),
      getProbableUser: () => null,
    },
    backend: {},
  },
}))

import { useChatContext } from "~/composables/chat-context"
import { WorkspaceService } from "~/services/workspace.service"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { defineActionHandler } from "~/helpers/actions"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import { getDefaultGQLRequest } from "@apirequest/data"

const LONG_URL = `https://a.example/?filter=${"x".repeat(50_000)}`

describe("useChatContext", () => {
  let container: TestContainer
  let app: App | null
  let context: ReturnType<typeof useChatContext>

  const mount = () => {
    app = createApp(
      defineComponent({
        setup() {
          // Stands in for pages/index.vue, the only page binding it.
          defineActionHandler("rest.request.open", () => {})
          context = useChatContext()
          return () => h("div")
        },
      })
    )
    app.use(diocPlugin, { container })
    app.mount(document.createElement("div"))
  }

  const unmount = () => {
    app?.unmount()
    app = null
  }

  beforeEach(() => {
    container = new TestContainer()
    container.bind(WorkspaceService)
    app = null
  })

  afterEach(() => {
    unmount()
  })

  it("caps a long query-param value", async () => {
    mount()
    const tabs = container.bind(WorkspaceTabsService)
    const tab = tabs.createNewTab({
      type: "request",
      request: {
        ...getDefaultRESTRequest(),
        params: [
          {
            key: "filter",
            value: "x".repeat(50_000),
            active: true,
            description: "",
          },
        ],
      },
      isDirty: false,
    } as never)
    tabs.setActiveTab(tab.id)

    const sent = context.contextFor(null)

    expect(sent).toContain(`- filter: ${"x".repeat(120)}…[truncated]`)
    expect(sent.length).toBeLessThan(5000)
  })

  // A query string typed in the URL bar stays in the endpoint.
  it.each([
    [
      "REST",
      {
        type: "request",
        request: { ...getDefaultRESTRequest(), endpoint: LONG_URL },
      },
    ],
    [
      "GraphQL",
      {
        type: "gql-request",
        request: { ...getDefaultGQLRequest(), url: LONG_URL },
        response: null,
      },
    ],
  ])("caps a long %s URL", (_, doc) => {
    mount()
    const tabs = container.bind(WorkspaceTabsService)
    const tab = tabs.createNewTab({ ...doc, isDirty: false } as never)
    tabs.setActiveTab(tab.id)

    const sent = context.contextFor(null)

    expect(sent).toContain("…[truncated]")
    expect(sent.length).toBeLessThan(5000)
  })

  it("keeps a normal URL whole", () => {
    mount()
    const tabs = container.bind(WorkspaceTabsService)
    const endpoint = `https://a.example/?filter=${"x".repeat(500)}`
    const tab = tabs.createNewTab({
      type: "request",
      request: { ...getDefaultRESTRequest(), endpoint },
      isDirty: false,
    } as never)
    tabs.setActiveTab(tab.id)

    expect(context.contextFor(null)).toContain(`GET ${endpoint}\n`)
  })
})
