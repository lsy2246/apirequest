/* eslint-disable vue/one-component-per-file -- Multiple component stubs mount the real editor. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { newRequestCase } from "@apirequest/data"
import AutomationSchedule from "../AutomationSchedule.vue"

const mocks = vi.hoisted(() => ({
  api: vi.fn(),
  scheduling: true,
  caseData: {} as Record<string, unknown[]>,
}))
vi.mock("../NotificationChannelPicker.vue", async () => {
  const { defineComponent, h } = await import("vue")
  return {
    default: defineComponent({
      setup: (_, { expose }) => {
        expose({ validate: async () => true })
        return () => h("div")
      },
    }),
  }
})
vi.mock("~/composables/workbenchRequestCases", async () => {
  const { ref } = await import("vue")
  return {
    useWorkbenchRequestCases: () => ({
      cases: ref(mocks.caseData),
      ready: Promise.resolve(),
    }),
  }
})
vi.mock("~/helpers/workbench-mcp", () => ({
  workbenchMcpAPI: mocks.api,
  workbenchSchedulesAvailable: () => mocks.scheduling,
}))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/workbenchCollections", async () => {
  const { ref } = await import("vue")
  return {
    useWorkbenchCollections: () => ({
      collections: ref([
        {
          id: "group",
          name: "Group",
          requests: [],
          folders: [
            {
              id: "nested",
              name: "Nested",
              requests: [{ id: "request", name: "Request", method: "GET" }],
              folders: [],
            },
          ],
        },
        {
          id: "other-group",
          _ref_id: "local-group",
          name: "Other group",
          requests: [
            {
              id: "other",
              _ref_id: "local-request",
              name: "Other request",
              method: "GET",
            },
            { id: "empty", name: "No cases", method: "GET" },
          ],
          folders: [],
        },
      ]),
    }),
  }
})
vi.mock("~/newstore/collections", () => ({
  isRootRequestCollection: () => false,
}))
vi.mock("~/newstore/environments", () => ({ environments$: {} }))
vi.mock("~/composables/stream", async () => {
  const { ref } = await import("vue")
  return {
    useReadonlyStream: () =>
      ref([{ id: "env", name: "Environment", variables: [] }]),
  }
})
vi.mock("dioc/vue", () => ({ useService: () => ({}) }))
vi.mock("~/services/current-environment-value.service", () => ({
  CurrentValueService: class {},
}))
vi.mock("~/services/secret-environment.service", () => ({
  SecretEnvironmentService: class {},
}))
vi.mock("../Select.vue", async () => {
  const { defineComponent, h } = await import("vue")
  return {
    default: defineComponent({
      props: {
        modelValue: { type: String, default: "" },
        options: { type: Array, required: true },
        label: { type: String, default: "" },
      },
      emits: ["update:modelValue"],
      setup:
        (props, { emit }) =>
        () =>
          h(
            "select",
            {
              "aria-label": props.label,
              value: props.modelValue,
              onChange: (event: Event) =>
                emit(
                  "update:modelValue",
                  (event.target as HTMLSelectElement).value
                ),
            },
            props.options.map((option: any) =>
              h("option", { value: option.value }, option.label)
            )
          ),
    }),
  }
})

const apps: App[] = []
function mount(props = {}) {
  const target = document.createElement("div")
  const app = createApp(AutomationSchedule, props)
  app.component(
    "RouterLink",
    defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("a", slots.default?.()),
    })
  )
  app.component(
    "HoppSmartModal",
    defineComponent({
      props: { title: { type: String, default: "" } },
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
        props: { label: { type: String, default: "" }, loading: Boolean },
        setup: (props) => () => h("button", props.label),
      })
    )
  app.mount(target)
  apps.push(app)
  return target
}
const plan = {
  id: "plan",
  name: "Plan",
  collectionID: "nested",
  requestID: "request",
  config: { iterations: 3, delay: 250 },
}
async function submit(target: HTMLElement) {
  target
    .querySelector("form")!
    .dispatchEvent(new Event("submit", { cancelable: true }))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
async function choose(target: HTMLElement, label: string, value: string) {
  const select = target.querySelector<HTMLSelectElement>(
    `select[aria-label="${label}"]`
  )!
  select.value = value
  select.dispatchEvent(new Event("change"))
  await nextTick()
}
beforeEach(() => {
  mocks.caseData = {
    request: [
      { ...newRequestCase(), id: "case-first", name: "First case" },
      { ...newRequestCase(), id: "case-second", name: "Second case" },
    ],
    other: [{ ...newRequestCase(), id: "case-other", name: "Other case" }],
  }
  mocks.scheduling = true
  mocks.api.mockResolvedValue({})
})
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  vi.clearAllMocks()
})

async function tickCheckbox(target: HTMLElement, label: string) {
  const input = target.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"]`
  )!
  expect(input).toBeTruthy()
  input.checked = !input.checked
  input.dispatchEvent(new Event("change", { bubbles: true }))
  await nextTick()
}
async function expandAll(target: HTMLElement) {
  Array.from(target.querySelectorAll("button"))
    .find((button) => button.textContent === "automation_cases.expand_all")!
    .click()
  await nextTick()
}

describe("hierarchical automation plan editor", () => {
  it("keeps Webhook summary and error-detail preferences independently when saving", async () => {
    const target = mount({ plan })
    const toggle = (label: string) =>
      Array.from(
        target.querySelectorAll<HTMLButtonElement>('[role="switch"]')
      ).find((item) => item.textContent?.trim() === label)!
    expect(toggle("automation_webhook.include_details")).toBeUndefined()
    toggle("automation_webhook.enable").click()
    await nextTick()
    expect(
      toggle("automation_webhook.include_details").getAttribute("aria-checked")
    ).toBe("false")
    toggle("automation_webhook.include_details").click()
    await nextTick()
    await submit(target)
    expect(mocks.api.mock.calls[0][1].config.webhook).toEqual({
      enabled: true,
      includeErrorDetails: true,
    })
    toggle("automation_webhook.enable").click()
    await nextTick()
    await submit(target)
    expect(mocks.api.mock.calls[1][1].config.webhook).toEqual({
      enabled: false,
      includeErrorDetails: true,
    })
  })
  it("selects cases across folders, saves the source requests and never adds requests without cases", async () => {
    const target = mount()
    await tickCheckbox(target, "Group")
    await tickCheckbox(target, "Other group")
    await submit(target)
    expect(mocks.api).toHaveBeenCalledOnce()
    expect(mocks.api.mock.calls[0][1]).toMatchObject({
      collectionID: "nested",
      config: {
        casesOnly: true,
        selectedRequestIDs: ["request", "other"],
        selectedCaseIDs: ["case-first", "case-second", "case-other"],
        requestCases: mocks.caseData,
      },
      rule: null,
    })
  })

  it("shows partial selection on every ancestor and disables requests without cases", async () => {
    const target = mount({ plan })
    await expandAll(target)
    await tickCheckbox(target, "First case")
    expect(
      target.querySelector<HTMLInputElement>('input[aria-label="Group"]')!
        .indeterminate
    ).toBe(true)
    expect(
      target.querySelector<HTMLInputElement>('input[aria-label="Nested"]')!
        .indeterminate
    ).toBe(true)
    expect(
      target.querySelector<HTMLInputElement>('input[aria-label="Request"]')!
        .indeterminate
    ).toBe(true)
    expect(
      target.querySelector<HTMLInputElement>('input[aria-label="No cases"]')!
        .disabled
    ).toBe(true)
    await submit(target)
    expect(mocks.api.mock.calls[0][1].config.selectedCaseIDs).toEqual([
      "case-second",
    ])
  })

  it("searches case names with ancestors and can display only selected cases", async () => {
    const target = mount({ plan })
    const search = target.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )!
    search.value = "Other case"
    search.dispatchEvent(new Event("input"))
    await nextTick()
    const tree = target.querySelector('[data-testid="case-tree"]')!
    expect(tree.textContent).toContain("Other group")
    expect(tree.textContent).toContain("Other request")
    expect(tree.textContent).toContain("Other case")
    expect(tree.textContent).not.toContain("First case")
    search.value = ""
    search.dispatchEvent(new Event("input"))
    await nextTick()
    const selectedOnly = target.querySelector<HTMLInputElement>(
      'input[type="checkbox"]'
    )!
    selectedOnly.checked = true
    selectedOnly.dispatchEvent(new Event("change"))
    await nextTick()
    expect(tree.textContent).toContain("First case")
    expect(tree.textContent).not.toContain("Other group")
  })

  it("does not save an empty selection", async () => {
    const target = mount()
    await submit(target)
    expect(mocks.api).not.toHaveBeenCalled()
    expect(target.textContent).toContain("automation_cases.empty")
  })

  it("drops legacy plan timeouts and hides controls that do not apply to isolated cases", async () => {
    const target = mount({
      plan: {
        ...plan,
        config: {
          ...plan.config,
          caseTimeoutMs: 45000,
          keepVariableValues: true,
        },
      },
    })
    expect(target.querySelector('input[name="caseTimeoutMs"]')).toBeNull()
    expect(target.textContent).not.toContain("automation_cases.default_timeout")
    expect(target.textContent).not.toContain(
      "workbench_schedule.keep_variable_values"
    )
    await submit(target)
    const saved = mocks.api.mock.calls[0][1].config
    expect(saved).toMatchObject({
      iterations: 3,
      delay: 250,
      executeScripts: true,
      keepVariableValues: false,
    })
    expect(saved).not.toHaveProperty("caseTimeoutMs")
  })

  it("keeps case definitions, time limits and saved selection when reopened", async () => {
    const first = {
      ...newRequestCase(),
      id: "case-first",
      name: "Timed case",
      timeoutMs: 1234,
    }
    mocks.caseData = {}
    const target = mount({
      plan: {
        ...plan,
        config: {
          ...plan.config,
          selectedCaseIDs: [first.id],
          selectedRequestIDs: ["request"],
          casesOnly: true,
          requestCases: { request: [first] },
        },
      },
    })
    await submit(target)
    expect(mocks.api.mock.calls[0][1].config).toMatchObject({
      selectedCaseIDs: [first.id],
      requestCases: { request: [first] },
    })
  })

  it("preserves execution switches and supports daily and weekly schedules", async () => {
    const target = mount({ plan })
    target
      .querySelectorAll<HTMLButtonElement>('[role="switch"]')
      .forEach((toggle) => toggle.click())
    await nextTick()
    await choose(target, "workbench_schedule.rule", "daily")
    await submit(target)
    expect(mocks.api.mock.calls[0][1]).toMatchObject({
      rule: { type: "daily" },
      config: {
        executeScripts: false,
        stopOnError: true,
        persistResponses: false,
        keepVariableValues: false,
      },
    })
    await choose(target, "workbench_schedule.rule", "weekly")
    await submit(target)
    expect(mocks.api.mock.calls[1][1].rule).toMatchObject({ type: "weekly" })
  })

  it("supports native manual plans with the same case selection", async () => {
    mocks.scheduling = false
    const target = mount({ plan })
    await submit(target)
    expect(mocks.api.mock.calls[0][0]).toBe("configs/automation/plan")
    expect(mocks.api.mock.calls[0][1]).toMatchObject({
      requestID: "request",
      config: { selectedRequestIDs: ["request"], casesOnly: true },
    })
    expect(
      target.querySelector('select[aria-label="workbench_schedule.rule"]')
    ).toBeNull()
  })
})
