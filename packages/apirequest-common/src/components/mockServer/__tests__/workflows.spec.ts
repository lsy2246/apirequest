/* eslint-disable vue/one-component-per-file -- lightweight UI stubs for workflow tests */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, type App } from "vue"
import DebugRequest from "../DebugRequest.vue"
import ForwardFields from "../ForwardFields.vue"
import MockTools from "../MockTools.vue"
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/helpers/mockServer/rules", () => ({
  mockRuleAPI: mocks.api,
  defaultForward: () => ({
    url: "",
    path: "",
    method: "",
    headers: {},
    removeHeaders: [],
    timeoutMs: 30000,
    preserveQuery: true,
  }),
}))
let app: App | undefined
function mount(component: any, props: any) {
  const target = document.createElement("div")
  document.body.append(target)
  app = createApp(component, props)
  app.component(
    "HoppSmartModal",
    defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("section", { role: "dialog" }, [slots.body?.(), slots.footer?.()]),
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
            { type: props.type || "button", disabled: props.disabled },
            props.label
          ),
      })
    )
  app.mount(target)
  return target
}
const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await nextTick()
  }
}
const click = (target: HTMLElement, label: string) => {
  const button = Array.from(target.querySelectorAll("button")).find(
    (v) => v.textContent === label
  )
  if (!button) throw new Error(`Missing button ${label}`)
  button.click()
}
const rule = {
  id: "rule-0001",
  name: "example",
  enabled: true,
  method: "GET",
  path: "/hello",
  conditions: [],
  exhausted: "repeat_last",
  steps: [
    {
      action: "http",
      statusCode: 200,
      body: "ok",
      headers: {},
      times: 1,
      delayMs: 0,
      intervalMs: 0,
    },
  ],
}
const server = {
  id: "server-1",
  name: "Mock",
  url: "http://127.0.0.1:1234/mock/server-1",
  kind: "collection",
  revision: 1,
  rules: [],
  isActive: true,
}
beforeEach(() => {
  mocks.api.mockReset()
})
afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ""
})
describe("Mock panel workflows", () => {
  it("keeps an unfinished header edit and validates it before saving", async () => {
    const model = {
      url: "http://localhost:8080",
      headers: {},
      removeHeaders: [],
      timeoutMs: 30000,
      preserveQuery: true,
    }
    const target = mount(ForwardFields, { modelValue: model })
    const textarea = target.querySelector("textarea")!
    textarea.value = "{"
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(textarea.value).toBe("{")
    expect(textarea.validity.valid).toBe(false)
    textarea.value = '{"x-custom":"value"}'
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
    await nextTick()
    expect(model.headers).toEqual({ "x-custom": "value" })
    expect(textarea.validity.valid).toBe(true)
  })

  it("previews unsaved rules without sending a real request", async () => {
    mocks.api.mockResolvedValue({
      selection: null,
      fallback: null,
      trace: [
        {
          ruleID: "rule-0001",
          name: "example",
          matched: false,
          reasons: [
            {
              code: "condition",
              field: "body.id equals",
              expected: "7",
              actual: "3",
            },
          ],
        },
      ],
    })
    const target = mount(DebugRequest, {
      serverID: server.id,
      rules: [rule],
      initialPath: "/hello",
    })
    click(target, "mock_tools.inspect")
    await settle()
    expect(mocks.api).toHaveBeenCalledWith(
      "server-1/inspect",
      expect.objectContaining({
        rules: [rule],
        request: expect.objectContaining({ path: "/hello" }),
      })
    )
    expect(target.textContent).toContain("mock_tools.condition")
    expect(target.textContent).toContain("body.id equals")
    expect(target.textContent).not.toContain("mock_tools.send_hint")
  })
  it("saves service options with the latest rules and revision", async () => {
    mocks.api.mockImplementation(async (path: string, data?: unknown) =>
      path.includes("/logs")
        ? []
        : data
          ? {}
          : {
              revision: 41,
              rules: [rule],
              hits: {},
              options: { recording: false },
            }
    )
    const target = mount(MockTools, { server, mode: "settings" })
    await settle()
    expect(target.querySelector("nav")).toBeNull()
    expect(target.querySelector("article")).toBeNull()
    expect(target.textContent).toContain("mock_tools.inspect")
    expect(mocks.api).not.toHaveBeenCalledWith(`${server.id}/logs?skip=0`)
    const check = target.querySelector<HTMLInputElement>(
      "input[type=checkbox]"
    )!
    expect(check).not.toBeNull()
    const recording = target.querySelectorAll<HTMLInputElement>(
      "input[type=checkbox]"
    )[1]
    recording.checked = true
    recording.dispatchEvent(new Event("change", { bubbles: true }))
    click(target, "action.save")
    await settle()
    expect(mocks.api).toHaveBeenCalledWith(server.id, {
      revision: 41,
      rules: [rule],
      options: { recording: true },
    })
  })
  it("fetches request details and exposes replay and capture for complete responses", async () => {
    const detail = {
      id: "log-1",
      requestMethod: "GET",
      requestPath: "/hello",
      executedAt: "2026-11-13T00:00:00Z",
      responseStatus: 200,
      responseTime: 1,
      responseHeaders: {},
      requestHeaders: {},
      responseBody: '{"ok":true,"items":[1,2]}',
      requestQuery: { page: "1" },
      requestBody: { name: "Demo" },
      mockMatch: { name: "example" },
    }
    mocks.api.mockImplementation(async (path: string) =>
      path.endsWith("/logs?skip=0")
        ? [detail]
        : path.endsWith("/logs/log-1/capture")
          ? rule
          : path.endsWith("/logs/log-1")
            ? detail
            : { revision: 1, rules: [], options: {} }
    )
    const captured = vi.fn()
    const target = mount(MockTools, {
      server,
      mode: "logs",
      onCapture: captured,
    })
    await settle()
    expect(target.querySelector("nav")).toBeNull()
    expect(target.querySelector("form")).toBeNull()
    expect(target.textContent).not.toContain("mock_tools.inspect")
    expect(target.textContent).not.toContain("mock_tools.fallback")
    expect(mocks.api).not.toHaveBeenCalledWith(server.id)
    const record = Array.from(
      target.querySelectorAll("article button")
    )[0] as HTMLButtonElement
    record.click()
    await settle()
    const payloads = [...target.querySelectorAll(".log-payload")].map(
      (node) => node.textContent
    )
    expect(payloads).toEqual([
      "{}",
      '{\n  "page": "1"\n}',
      '{\n  "name": "Demo"\n}',
      "{}",
      '{\n  "ok": true,\n  "items": [\n    1,\n    2\n  ]\n}',
    ])
    expect(target.querySelector(".mock-log-detail")?.textContent).toContain(
      "200"
    )
    click(target, "mock_tools.save_rule")
    await settle()
    expect(captured).toHaveBeenCalledWith(server, rule)
    expect(mocks.api).not.toHaveBeenCalledWith(
      server.id,
      expect.objectContaining({ rules: expect.anything() })
    )
  })
})
