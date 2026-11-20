import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import Reports from "../Reports.vue"
import LiveRuns from "../LiveRuns.vue"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  navigate: vi.fn(),
  refresh: undefined as undefined | (() => Promise<void>),
  download: vi.fn(),
  remove: vi.fn(),
  localReports: [] as any[],
}))
vi.mock("vue-router", () => ({ useRouter: () => ({ push: mocks.navigate }) }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/workbenchReports", async () => {
  const { ref } = await import("vue")
  return {
    useWorkbenchReports: () => ({
      reports: ref(mocks.localReports),
      remove: mocks.remove,
    }),
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
  app.component(
    "HoppSmartConfirmModal",
    defineComponent({
      props: ["show", "title"],
      emits: ["resolve", "hide-modal"],
      setup:
        (props, { emit }) =>
        () =>
          props.show
            ? h("section", { role: "alertdialog" }, [
                h("p", props.title),
                h(
                  "button",
                  { class: "confirm-delete", onClick: () => emit("resolve") },
                  "Confirm"
                ),
                h(
                  "button",
                  { class: "cancel-delete", onClick: () => emit("hide-modal") },
                  "Cancel"
                ),
              ])
            : null,
    })
  )
  app.mount(target)
  return target
}
afterEach(() => {
  app?.unmount()
  mocks.refresh = undefined
  mocks.localReports = []
  vi.clearAllMocks()
})
const report = {
  id: "run-1",
  kind: "automation",
  trigger: "schedule",
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
  it("merges backend notification state into a manual report without duplicating it or losing local details", async () => {
    const local = {
      ...report,
      trigger: undefined,
      steps: [
        ...report.steps,
        { name: "Local details", passed: true, errors: [] },
      ],
    }
    mocks.localReports = [local]
    mocks.api.mockResolvedValue([
      {
        ...report,
        trigger: undefined,
        backendStored: true,
        notification: { status: "sent", attempts: 1 },
      },
    ])
    const target = mount(Reports, { kind: "automation" })
    await mocks.refresh?.()
    await nextTick()
    expect(target.querySelectorAll(".report-open")).toHaveLength(1)
    expect(target.textContent).toContain("automation_webhook.sent")
    target.querySelector<HTMLButtonElement>(".report-export")!.click()
    expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ steps: local.steps, backendStored: true })
    )
  })
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

it("shows all reports beyond 20 and labels paused and running reports", async () => {
  mocks.api.mockResolvedValue(
    Array.from({ length: 35 }, (_, index) => ({
      ...report,
      trigger: "schedule",
      id: String(index),
      name: `Run ${index}`,
      automation: {
        ...report.automation,
        status: index === 0 ? "running" : index === 1 ? "paused" : "completed",
      },
    }))
  )
  const target = mount(Reports, { kind: "automation" })
  await mocks.refresh?.()
  await nextTick()
  expect(target.querySelectorAll(".report-open")).toHaveLength(35)
  expect(target.textContent).toContain("workbench_live.running")
  expect(target.textContent).toContain("workbench_live.paused")
  const buttons = Array.from(
    target.querySelectorAll<HTMLButtonElement>("button")
  )
  const pause = buttons.find(
    (button) => button.textContent === "workbench_live.pause"
  )!
  mocks.api.mockResolvedValue({ status: "pausing" })
  pause.click()
  await nextTick()
  expect(mocks.api).toHaveBeenLastCalledWith("automation/runs/0/control", {
    action: "pause",
  })
})

it("confirms deletion of a completed scheduled report and does not restore it from a stale refresh", async () => {
  mocks.api.mockImplementation(async (path: string) =>
    path.endsWith("/delete") ? { deleted: true } : [report]
  )
  const target = mount(Reports, { kind: "automation" })
  await mocks.refresh?.()
  await nextTick()
  target.querySelector<HTMLButtonElement>(".report-delete")!.click()
  await nextTick()
  expect(mocks.api).not.toHaveBeenCalledWith(
    "automation/reports/run-1/delete",
    {}
  )
  target.querySelector<HTMLButtonElement>(".confirm-delete")!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mocks.api).toHaveBeenCalledWith("automation/reports/run-1/delete", {})
  expect(target.querySelectorAll(".report-open")).toHaveLength(0)
  await mocks.refresh?.()
  await nextTick()
  expect(target.querySelectorAll(".report-open")).toHaveLength(0)
})

it("allows canceling deletion and keeps a failed deletion visible", async () => {
  mocks.api.mockResolvedValue([report])
  const target = mount(Reports, { kind: "automation" })
  await mocks.refresh?.()
  await nextTick()
  target.querySelector<HTMLButtonElement>(".report-delete")!.click()
  await nextTick()
  target.querySelector<HTMLButtonElement>(".cancel-delete")!.click()
  await nextTick()
  expect(target.querySelectorAll(".report-open")).toHaveLength(1)
  expect(target.querySelector('[role="alertdialog"]')).toBeNull()
  target.querySelector<HTMLButtonElement>(".report-delete")!.click()
  await nextTick()
  mocks.api.mockRejectedValueOnce(new Error("delete failed"))
  target.querySelector<HTMLButtonElement>(".confirm-delete")!.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(target.querySelectorAll(".report-open")).toHaveLength(1)
  expect(target.textContent).toContain("workbench.report_delete_failed")
})

it("allows deleting paused reports and blocks only requests still running", async () => {
  mocks.api.mockResolvedValue(
    ["running", "pausing", "paused"].map((status) => ({
      ...report,
      id: status,
      automation: { ...report.automation, status },
    }))
  )
  const target = mount(Reports, { kind: "automation" })
  await mocks.refresh?.()
  await nextTick()
  const buttons = Array.from(
    target.querySelectorAll<HTMLButtonElement>(".report-delete")
  )
  expect(buttons).toHaveLength(3)
  expect(buttons.map((button) => button.disabled)).toEqual([true, true, false])
})

it("offers a decision before resuming an interrupted report with an unknown request", async () => {
  mocks.api.mockResolvedValue([
    {
      ...report,
      automation: { ...report.automation, status: "interrupted" },
      canResume: true,
      uncertainRequest: { name: "Unknown write", iteration: 1 },
    },
  ])
  const target = mount(Reports, { kind: "automation" })
  await mocks.refresh?.()
  await nextTick()
  const resume = Array.from(
    target.querySelectorAll<HTMLButtonElement>("button")
  ).find((button) => button.textContent === "workbench_live.resume")!
  resume.click()
  await nextTick()
  const dialog = target.querySelector('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(mocks.api).toHaveBeenCalledTimes(1)
  const skip = Array.from(
    dialog.querySelectorAll<HTMLButtonElement>("button")
  ).find((button) => button.textContent === "workbench.recovery_skip")!
  mocks.api.mockResolvedValue({ status: "running" })
  skip.click()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(mocks.api).toHaveBeenLastCalledWith("automation/runs/run-1/control", {
    action: "resume",
    choice: "skip",
  })
})
