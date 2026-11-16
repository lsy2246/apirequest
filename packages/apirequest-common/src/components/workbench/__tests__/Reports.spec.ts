import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import Reports from "../Reports.vue"
import LiveRuns from "../LiveRuns.vue"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  refresh: undefined as undefined | (() => Promise<void>),
  download: vi.fn(),
}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.navigate }) }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/workbenchReports", async () => {
  const { ref } = await import("vue")
  return {
    useWorkbenchReports: () => ({ reports: ref([]) }),
    downloadWorkbenchReport: mocks.download,
  }
})
vi.mock("~/helpers/workbench-mcp", () => ({
  workbenchMcpAPI: mocks.api,
  workbenchSchedulesAvailable: () => true,
}))
vi.mock("~/composables/workbenchLive", () => ({
  useWorkbenchLiveQuery: (_: unknown, callback: () => Promise<void>) => {
    mocks.refresh = callback
  },
}))
let app: App | undefined
function mount(component: any, props = {}) {
  const target = document.createElement("div")
  app = createApp(component, props)
  app.component(
    "HoppSmartModal",
    defineComponent({
      props: ["title"],
      emits: ["close"],
      setup:
        (props, { slots }) =>
        () =>
          h("section", { role: "dialog" }, [
            h("h2", props.title),
            slots.body?.(),
            slots.footer?.(),
          ]),
    })
  )
  for (const name of ["HoppButtonPrimary", "HoppButtonSecondary"])
    app.component(
      name,
      defineComponent({
        props: ["label"],
        setup: (props) => () => h("button", props.label),
      })
    )
  app.component(
    "WorkbenchState",
    defineComponent({ setup: () => () => h("div") })
  )
  app.mount(target)
  return target
}
afterEach(() => {
  app?.unmount()
  mocks.refresh = undefined
  vi.clearAllMocks()
})
const report = {
  id: "run-1",
  kind: "automation",
  name: "Scheduled suite",
  createdAt: "2026-11-13T00:00:00Z",
  summary: { completed: 2, failed: 1, elapsedMs: 1550 },
  automation: {
    status: "failed",
    passedTests: 2,
    failedTests: 1,
    totalTests: 3,
  },
  steps: [
    { name: "Read", passed: true, elapsedMs: 12, errors: [] },
    { name: "Write", passed: false, elapsedMs: 20, errors: ["REQUEST_ERROR"] },
  ],
}

describe("automation reports and live progress", () => {
  it("opens automation history in its result page and keeps JSON export separate", async () => {
    mocks.api.mockResolvedValue([report])
    const target = mount(Reports, { kind: "automation" })
    await mocks.refresh?.()
    await nextTick()
    target.querySelector<HTMLButtonElement>(".report-open")!.click()
    expect(mocks.navigate).toHaveBeenCalledWith({
      path: "/automation",
      query: { report: "run-1" },
    })
    expect(target.querySelector('[role="dialog"]')).toBeNull()
    target.querySelector<HTMLButtonElement>(".report-export")!.click()
    expect(mocks.download).toHaveBeenCalledWith(report)
  })
  it("shows only active runs and removes progress after completion", async () => {
    mocks.api.mockResolvedValue([
      {
        id: "active",
        name: "Running suite",
        status: "running",
        completed: 1,
        total: 3,
      },
      {
        id: "finished",
        name: "Finished suite",
        status: "failed",
        completed: 3,
        total: 3,
      },
    ])
    const target = mount(LiveRuns)
    await mocks.refresh?.()
    await nextTick()
    expect(target.textContent).toContain("Running suite")
    expect(target.textContent).not.toContain("Finished suite")
    expect(target.querySelectorAll("progress")).toHaveLength(1)
    mocks.api.mockResolvedValue([
      {
        id: "active",
        name: "Running suite",
        status: "completed",
        completed: 3,
        total: 3,
      },
    ])
    await mocks.refresh?.()
    await nextTick()
    expect(target.querySelector('[data-testid="live-runs"]')).toBeNull()
  })
})
