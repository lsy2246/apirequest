import { TestContainer } from "dioc/testing"
import { afterEach, describe, expect, it, vi } from "vitest"
import { computed, nextTick, ref } from "vue"
import { getDefaultGQLRequest } from "@apirequest/data"
import { getDefaultRESTRequest } from "~/helpers/rest/default"
import type { HoppTabDocument } from "~/helpers/tab/document"
import type { HoppTab } from "~/services/tab"
import { WorkspaceTabsService } from "~/services/tab/workspace-tabs"
import { SpotlightService } from "../.."
import { RequestSpotlightSearcherService } from "../request.searcher"

const route = vi.hoisted(() => ({ name: "index" }))
vi.mock("vue-router", () => ({ useRoute: () => route }))
vi.mock("~/modules/i18n", () => ({ getI18n: () => (key: string) => key }))
vi.mock("~/helpers/actions", async () => {
  const { ref } = await import("vue")
  return { invokeAction: vi.fn(), isActionBound: () => ref(false) }
})

describe("request search actions in the unified workspace", () => {
  let endSession: (() => void) | undefined
  afterEach(() => endSession?.())

  it.each<[string, "request" | "gql-request", boolean]>([
    ["index", "gql-request", true],
    ["index", "request", false],
    ["history", "gql-request", false],
    ["graphql", "gql-request", false],
  ])(
    "shows GraphQL query actions on %s with %s: %s",
    async (page, type, visible) => {
      route.name = page
      const container = new TestContainer()
      container.bindMock(SpotlightService, { registerSearcher: vi.fn() })
      const tab: HoppTab<HoppTabDocument> = {
        id: "active",
        document:
          type === "request"
            ? { type, request: getDefaultRESTRequest(), isDirty: false }
            : {
                type,
                request: getDefaultGQLRequest(),
                isDirty: false,
                cursorPosition: 0,
              },
      }
      container.bindMock(WorkspaceTabsService, {
        currentActiveTab: computed(() => tab),
      })
      const searcher = container.bind(RequestSpotlightSearcherService)
      const query = ref("")
      const [state, stop] = searcher.createSearchSession(query)
      endSession = stop
      await vi.waitFor(() => expect(state.value.loading).toBe(false))
      query.value = "query"
      await nextTick()
      expect(state.value.results.some(({ id }) => id === "tab_query")).toBe(
        visible
      )
    }
  )
})
