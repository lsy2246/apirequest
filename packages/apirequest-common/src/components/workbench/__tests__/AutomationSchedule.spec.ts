/* eslint-disable vue/one-component-per-file -- Multiple component stubs mount the real editor. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import { getAutomationConfig } from "@apirequest/data"
import AutomationSchedule from "../AutomationSchedule.vue"

const mocks = vi.hoisted(() => ({ api: vi.fn(), scheduling: true }))
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
          _ref_id: "local-group",
          name: "Local group",
          requests: [
            { _ref_id: "local-request", name: "Local request", method: "GET" },
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
  mocks.scheduling = true
  mocks.api.mockResolvedValue({})
})
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount())
  vi.clearAllMocks()
})

describe("shared automation plan editor", () => {
  it("offers the same execution fields, toggles and rule choices for create and edit", () => {
    const created = mount(),
      edited = mount({ plan })
    const fields = (target: HTMLElement) => [
      ...Array.from(target.querySelectorAll("input"), (input) => input.name),
      ...Array.from(target.querySelectorAll('[role="switch"]'), (toggle) =>
        toggle.textContent?.trim()
      ),
      ...Array.from(
        target.querySelectorAll(
          'select[aria-label="workbench_schedule.rule"] option'
        ),
        (option) => (option as HTMLOptionElement).value
      ),
    ]
    expect(fields(created)).toEqual(fields(edited))
    expect(
      created.querySelector<HTMLInputElement>('[name="delay"]')!.value
    ).toBe("0")
    expect(
      edited.querySelector<HTMLInputElement>('[name="delay"]')!.value
    ).toBe("250")
    expect(
      edited.querySelector('[aria-pressed="true"]')?.textContent
    ).toContain("Request")
  })

  it("creates a manual plan with explicit defaults and persists it without running", async () => {
    const saved = vi.fn(),
      target = mount({ onSaved: saved })
    target.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click()
    await nextTick()
    await submit(target)
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith("automation/schedules", {
      collectionID: "group",
      environmentID: null,
      rule: null,
      draftRule: { type: "interval", minutes: 30 },
      overrides: undefined,
      config: getAutomationConfig(),
    })
    expect(saved).toHaveBeenCalledOnce()
  })

  it("preserves legacy defaults on an unchanged save and allows switching a request to a group", async () => {
    const target = mount({ plan })
    await submit(target)
    expect(mocks.api.mock.calls[0][1].config).toEqual(
      getAutomationConfig(plan.config)
    )
    expect(mocks.api.mock.calls[0][1].requestID).toBe("request")
    target.querySelector<HTMLButtonElement>('[aria-pressed="false"]')!.click()
    await nextTick()
    await submit(target)
    expect(mocks.api.mock.calls[1][1]).toMatchObject({ collectionID: "group" })
    expect(mocks.api.mock.calls[1][1]).not.toHaveProperty("requestID")
  })

  it("persists all execution switches from the shared form", async () => {
    const target = mount({ plan })
    target
      .querySelectorAll<HTMLButtonElement>('[role="switch"]')
      .forEach((toggle) => toggle.click())
    await nextTick()
    await submit(target)
    expect(mocks.api.mock.calls[0][1].config).toEqual({
      iterations: 3,
      delay: 250,
      stopOnError: true,
      persistResponses: false,
      executeScripts: false,
      keepVariableValues: true,
    })
  })

  it("retains interval drafts while toggling scheduling and saves the chosen environment", async () => {
    const target = mount({ plan })
    await choose(target, "workbench_schedule.rule", "interval")
    const input = target.querySelector<HTMLInputElement>('input[max="10080"]')!
    input.value = "45"
    input.dispatchEvent(new Event("input"))
    await choose(target, "workbench_schedule.rule", "off")
    await choose(target, "workbench_schedule.rule", "interval")
    expect(
      target.querySelector<HTMLInputElement>('input[max="10080"]')!.value
    ).toBe("45")
    await choose(target, "workbench_schedule.environment", "env")
    await submit(target)
    expect(mocks.api.mock.calls[0][1]).toMatchObject({
      environmentID: "env",
      rule: { type: "interval", minutes: 45 },
    })
  })

  it("restores the saved schedule draft after disabling and reopening a plan", async () => {
    const target = mount({
      plan,
      schedule: {
        planID: "plan",
        environmentID: null,
        rule: { type: "interval", minutes: 45 },
        nextRunAt: 123,
      },
    })
    await choose(target, "workbench_schedule.rule", "off")
    await submit(target)
    const saved = mocks.api.mock.calls[0][1]
    expect(saved.rule).toBeNull()
    expect(saved.draftRule).toEqual({ type: "interval", minutes: 45 })
    const reopened = mount({
      plan,
      schedule: { ...saved, planID: "plan", nextRunAt: null },
    })
    expect(
      reopened.querySelector<HTMLSelectElement>(
        'select[aria-label="workbench_schedule.rule"]'
      )!.value
    ).toBe("off")
    await choose(reopened, "workbench_schedule.rule", "interval")
    expect(
      reopened.querySelector<HTMLInputElement>('input[max="10080"]')!.value
    ).toBe("45")
  })

  it("blocks saving a deleted target until another target is selected", async () => {
    const target = mount({ plan: { ...plan, requestID: "deleted" } })
    expect(target.querySelector('[role="alert"]')?.textContent).toContain(
      "workbench_schedule.target_missing"
    )
    await submit(target)
    expect(mocks.api).not.toHaveBeenCalled()
  })

  it.each(["0", "1.5", "1001"])(
    "rejects invalid iterations %s before saving",
    async (value) => {
      const target = mount({ plan })
      const input = target.querySelector<HTMLInputElement>(
        '[name="iterations"]'
      )!
      input.value = value
      input.dispatchEvent(new Event("input"))
      await nextTick()
      await submit(target)
      expect(mocks.api).not.toHaveBeenCalled()
    }
  )

  it("supports local targets and hides scheduling in the desktop editor", async () => {
    mocks.scheduling = false
    const target = mount({
      plan: {
        id: "local",
        name: "Local",
        collectionID: "local-group",
        requestID: "local-request",
      },
    })
    expect(
      target.querySelector('select[aria-label="workbench_schedule.rule"]')
    ).toBeNull()
    await submit(target)
    expect(mocks.api).toHaveBeenCalledWith("configs/automation/local", {
      collectionID: "local-group",
      requestID: "local-request",
      environmentID: undefined,
      config: getAutomationConfig({}, { delay: 500, keepVariableValues: true }),
    })
  })

  it("uses shared new-plan defaults on desktop while keeping legacy defaults only for existing plans", async () => {
    mocks.scheduling = false
    const target = mount()
    Array.from(target.querySelectorAll<HTMLButtonElement>("[aria-pressed]"))
      .find((button) => button.title === "Local group")!
      .click()
    await nextTick()
    await submit(target)
    expect(mocks.api).toHaveBeenCalledWith("configs/automation", {
      collectionID: "local-group",
      requestID: null,
      environmentID: undefined,
      config: getAutomationConfig(),
    })
  })
})
