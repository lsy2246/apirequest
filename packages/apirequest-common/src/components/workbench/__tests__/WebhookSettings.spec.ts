/* eslint-disable vue/one-component-per-file -- Stubs mount the real settings form. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, type App } from "vue"
import WebhookSettings from "../WebhookSettings.vue"
const mocks = vi.hoisted(() => ({ api: vi.fn() }))
vi.mock("~/helpers/workbench-mcp", () => ({ workbenchMcpAPI: mocks.api }))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("../Select.vue", async () => {
  const { defineComponent, h } = await import("vue")
  return {
    default: defineComponent({
      props: {
        modelValue: { type: String, default: "" },
        label: { type: String, default: "" },
        options: { type: Array, default: () => [] },
      },
      emits: ["update:modelValue"],
      setup:
        (props, { emit }) =>
        () =>
          h(
            "select",
            {
              value: props.modelValue,
              "aria-label": props.label,
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
let app: App | undefined
async function mount() {
  const el = document.createElement("div")
  app = createApp(WebhookSettings)
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
            { type: props.type ?? "button", disabled: props.disabled },
            props.label
          ),
      })
    )
  app.mount(el)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return el
}
const endpoint = "automation/notification-channels"
const channels = [
  {
    id: "legacy",
    name: "Team bot",
    format: "feishu",
    enabled: true,
    url: "https://open.feishu.cn/open-apis/bot/v2/hook/example-token",
    hasSecret: true,
    legacy: true,
  },
  {
    id: "webhook",
    name: "Webhook channel",
    format: "json",
    enabled: false,
    url: "http://localhost/hook",
    hasSecret: false,
  },
]
beforeEach(() => {
  mocks.api.mockImplementation(async (path: string, body?: unknown) =>
    path === endpoint && body === undefined ? channels : { sent: true }
  )
})
afterEach(() => {
  app?.unmount()
  vi.clearAllMocks()
})
const click = (el: HTMLElement, label: string) =>
  Array.from(el.querySelectorAll<HTMLButtonElement>("button"))
    .find(
      (button) =>
        button.getAttribute("aria-label") === label ||
        button.textContent === label
    )!
    .click()
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
describe("notification channel management", () => {
  it("lists multiple formats and tests only the chosen saved channel", async () => {
    const el = await mount()
    expect(el.textContent).toContain("Team bot")
    expect(el.textContent).toContain("Webhook channel")
    click(el, "automation_webhook.test · Team bot")
    await settle()
    expect(mocks.api).toHaveBeenLastCalledWith(
      `${endpoint}/legacy/test`,
      {},
      expect.any(AbortSignal)
    )
    expect(el.textContent).toContain("automation_webhook.test_sent_feishu")
  })
  it("edits one channel without clearing its saved signing secret or including a site URL", async () => {
    const el = await mount()
    click(el, "action.edit · Team bot")
    await settle()
    const select = el.querySelector<HTMLSelectElement>("select")!
    expect(select.value).toBe("feishu")
    select.value = "json"
    select.dispatchEvent(new Event("change"))
    await settle()
    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true })
    )
    await settle()
    const call = mocks.api.mock.calls.find(
      ([path, body]) => path === `${endpoint}/legacy` && body
    )
    expect(call?.[1]).toMatchObject({
      name: "Team bot",
      format: "json",
      enabled: true,
    })
    expect(call?.[1]).not.toHaveProperty("secret")
    expect(call?.[1]).not.toHaveProperty("reportBaseURL")
  })
  it("surfaces a rejected robot notification without claiming success", async () => {
    const el = await mount()
    mocks.api.mockRejectedValueOnce(new Error("飞书机器人拒收（19002）"))
    click(el, "automation_webhook.test · Team bot")
    await settle()
    expect(el.querySelector('[role="alert"]')?.textContent).toContain("19002")
    expect(el.textContent).not.toContain("automation_webhook.test_sent_feishu")
  })
})
