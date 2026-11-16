/* eslint-disable vue/one-component-per-file -- UI stubs retain native form submission */
import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import RuleWorkbench from "../RuleWorkbench.vue"
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/workbenchLive", async () => {
  const { onMounted } = await import("vue")
  return {
    useWorkbenchLiveQuery: (_topics: string[], load: () => Promise<unknown>) =>
      onMounted(load),
  }
})
vi.mock("~/components/workbench/Select.vue", async () => {
  const { defineComponent, h } = await import("vue")
  return {
    default: defineComponent({
      props: {
        modelValue: { type: String, default: "" },
        options: { type: Array, default: () => [] },
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
            ((props.options as any[]) ?? []).map((v) =>
              h("option", { value: v.value }, v.label)
            )
          ),
    }),
  }
})
vi.mock("~/helpers/mockServer/rules", () => ({
  mockRuleAPI: mocks.api,
  mockRuleStatus: () => "active",
  nextMockStep: (rule: any) => rule.steps[0],
}))
let app: App
function mount() {
  const target = document.createElement("div")
  document.body.append(target)
  app = createApp(RuleWorkbench)
  app.component(
    "HoppSmartModal",
    defineComponent({
      emits: ["close"],
      setup:
        (_, { slots, emit }) =>
        () =>
          h("section", { role: "dialog" }, [
            h(
              "button",
              { type: "button", onClick: () => emit("close") },
              "modal-close"
            ),
            slots.body?.(),
            slots.footer?.(),
          ]),
    })
  )
  app.component(
    "HoppSmartConfirmModal",
    defineComponent({
      props: { show: Boolean },
      emits: ["resolve"],
      setup:
        (props, { emit }) =>
        () =>
          props.show
            ? h("button", { onClick: () => emit("resolve") }, "discard-confirm")
            : null,
    })
  )
  for (const name of ["HoppButtonPrimary", "HoppButtonSecondary"])
    app.component(
      name,
      defineComponent({
        props: {
          label: { type: String, default: "" },
          disabled: Boolean,
          type: { type: String, default: "button" },
        },
        setup: (props) => () =>
          h(
            "button",
            { type: props.type, disabled: props.disabled },
            props.label
          ),
      })
    )
  app.mount(target)
  return target
}
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
function click(target: ParentNode, text: string) {
  const button = [...target.querySelectorAll("button")].find(
    (v) => v.textContent === text
  )!
  expect(button).toBeDefined()
  button.click()
}
async function input(
  target: HTMLInputElement | HTMLTextAreaElement,
  value: string
) {
  target.value = value
  target.dispatchEvent(new Event("input", { bubbles: true }))
  await settle()
}
async function newMock(target: HTMLElement) {
  click(target, "action.new")
  await settle()
  await input(target.querySelector("#mock-create input")!, "Unsaved Mock")
  click(target.querySelector('[role="dialog"]')!, "action.proceed")
  await settle()
}
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ""
  mocks.api.mockReset()
})
describe("Mock editor saving", () => {
  it("keeps new defaults local until Save and allows saving them", async () => {
    mocks.api.mockResolvedValue([])
    const target = mount()
    await settle()
    await newMock(target)
    const save = target.querySelector<HTMLButtonElement>(
      'button[form="mock-rule-editor"]'
    )!
    expect(save.disabled).toBe(false)
    expect(mocks.api.mock.calls.some(([, data]) => data !== undefined)).toBe(
      false
    )
    expect(target.querySelector('[role="dialog"]')!.textContent).not.toContain(
      "action.cancel"
    )
    save.click()
    await settle()
    expect(mocks.api).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        name: "Unsaved Mock",
        kind: "single",
        rules: [
          expect.objectContaining({
            path: "/hello",
            steps: [expect.objectContaining({ body: "{}" })],
          }),
        ],
      })
    )
    expect(target.querySelector("#mock-rule-editor")).toBeNull()
  })
  it("discards a new Mock without writing an empty service", async () => {
    mocks.api.mockResolvedValue([])
    const target = mount()
    await settle()
    await newMock(target)
    click(target, "modal-close")
    await settle()
    click(target, "discard-confirm")
    await settle()
    expect(target.querySelector("#mock-rule-editor")).toBeNull()
    expect(mocks.api.mock.calls.some(([, data]) => data !== undefined)).toBe(
      false
    )
  })
  it("saves edits and retains them for retry after a save error", async () => {
    const rule = {
      id: "rule-0001",
      name: "Existing",
      method: "GET",
      path: "/hello",
      enabled: true,
      conditions: [],
      exhausted: "repeat_last",
      steps: [
        {
          action: "http",
          statusCode: 200,
          body: "ok",
          headers: {},
          delayMs: null,
          times: 1,
          intervalMs: 0,
          disconnectAfter: false,
        },
      ],
    }
    const server = {
      id: "server-1",
      name: "Existing",
      kind: "single",
      url: "http://localhost/mock/test",
      isActive: true,
      revision: 2,
      rules: [rule],
    }
    let fail = true
    mocks.api.mockImplementation(async (path = "", data?: any) => {
      if (!path) return [server]
      if (!data) return { kind: "single", revision: 2, rules: [rule], hits: {} }
      if (fail) throw new Error("Save failed")
      return { kind: "single", revision: 3, rules: data.rules, hits: {} }
    })
    const target = mount()
    await settle()
    target.querySelector<HTMLButtonElement>(".row-name")!.click()
    await settle()
    await input(target.querySelector('textarea[rows="4"]')!, "updated")
    const save = target.querySelector<HTMLButtonElement>(
      'button[form="mock-rule-editor"]'
    )!
    expect(save.disabled).toBe(false)
    save.click()
    await settle()
    expect(target.textContent).toContain("Save failed")
    expect(save.disabled).toBe(false)
    expect(
      target.querySelector<HTMLTextAreaElement>('textarea[rows="4"]')!.value
    ).toBe("updated")
    fail = false
    save.click()
    await settle()
    expect(mocks.api).toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({
        revision: 2,
        rules: [
          expect.objectContaining({
            steps: [expect.objectContaining({ body: "updated" })],
          }),
        ],
      })
    )
    expect(target.querySelector("#mock-rule-editor")).toBeNull()
  })
  it("saves script, Cookie, HTTPS and Schema settings from the editor", async () => {
    mocks.api.mockResolvedValue([])
    const target = mount()
    await settle()
    await newMock(target)
    const select = target.querySelector<HTMLSelectElement>(
      '[aria-label="mock_rule.response_type"]'
    )!
    select.value = "script"
    select.dispatchEvent(new Event("change", { bubbles: true }))
    await settle()
    await input(
      target.querySelector('textarea[rows="12"]')!,
      "return {body:{total:42}};"
    )
    await input(
      target.querySelector('[aria-label="mock_tools.response_cookies"]')!,
      "session=ok; HttpOnly\nold=; Max-Age=0"
    )
    const secure = [...target.querySelectorAll("select")].find((v) =>
      [...v.options].some((o) => o.value === "https")
    )!
    secure.value = "https"
    secure.dispatchEvent(new Event("change", { bubbles: true }))
    await settle()
    click(target, "mock_rule.add_condition")
    await settle()
    const op = target.querySelector<HTMLSelectElement>(
      '[aria-label="mock_tools.operator"]'
    )!
    op.value = "json_schema"
    op.dispatchEvent(new Event("change", { bubbles: true }))
    await settle()
    await input(
      target.querySelector('[aria-label="mock_tools.json_schema"]')!,
      '{"type":"object","required":["items"]}'
    )
    target
      .querySelector<HTMLButtonElement>('button[form="mock-rule-editor"]')!
      .click()
    await settle()
    expect(mocks.api).toHaveBeenCalledWith(
      "",
      expect.objectContaining({
        rules: [
          expect.objectContaining({
            secure: true,
            conditions: [
              expect.objectContaining({
                source: "body",
                operator: "json_schema",
                key: "$",
              }),
            ],
            steps: [
              expect.objectContaining({
                action: "script",
                script: { code: "return {body:{total:42}};", timeoutMs: 1000 },
                cookies: ["session=ok; HttpOnly", "old=; Max-Age=0"],
              }),
            ],
          }),
        ],
      })
    )
  })
  it("loads the code of an existing script rule", async () => {
    const rule = {
      id: "rule-script",
      name: "Script",
      method: "GET",
      path: "/code/:id",
      enabled: true,
      conditions: [],
      exhausted: "repeat_last",
      steps: [
        {
          action: "script",
          script: { code: "return {body:{ok:true}};", timeoutMs: 1000 },
          headers: {},
          cookies: [],
          delayMs: 0,
          times: 1,
          intervalMs: 0,
        },
      ],
    }
    mocks.api.mockImplementation(async (path = "") =>
      path
        ? { kind: "single", revision: 0, rules: [rule], hits: {} }
        : [
            {
              id: "server-script",
              name: "Script",
              kind: "single",
              isActive: true,
              rules: [rule],
            },
          ]
    )
    const target = mount()
    await settle()
    target.querySelector<HTMLButtonElement>(".row-name")!.click()
    await settle()
    expect(
      target.querySelector<HTMLTextAreaElement>('textarea[rows="12"]')!.value
    ).toBe(rule.steps[0].script.code)
  })
})
