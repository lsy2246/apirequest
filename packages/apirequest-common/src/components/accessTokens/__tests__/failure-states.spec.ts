import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import AccessTokens from "../index.vue"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
  ready: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}))
vi.mock("axios", () => ({ default: mocks }))
vi.mock("~/platform", () => ({
  platform: { auth: { waitProbableLoginToConfirm: mocks.ready } },
}))
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/toast", () => ({ useToast: () => mocks }))
let app: App
let target: HTMLElement
const token = {
  id: "token-1",
  label: "Test token",
  createdOn: "",
  lastUsedOn: "",
  expiresOn: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.ready.mockResolvedValue(undefined)
  mocks.get.mockResolvedValue({ data: [token] })
  mocks.post.mockResolvedValue({
    data: { token: "generated-token", info: token },
  })
  mocks.delete.mockResolvedValue({})
})
afterEach(() => app?.unmount())
async function mount() {
  target = document.createElement("div")
  app = createApp(AccessTokens)
  app.component(
    "AccessTokensOverview",
    defineComponent({
      emits: ["show-access-tokens-generate-modal"],
      setup:
        (_, { emit }) =>
        () =>
          h(
            "button",
            {
              id: "open",
              onClick: () => emit("show-access-tokens-generate-modal"),
            },
            "Open"
          ),
    })
  )
  app.component(
    "AccessTokensList",
    defineComponent({
      props: ["loading", "hasError", "accessTokens"],
      emits: ["fetch-more-tokens", "delete-access-token"],
      setup:
        (props, { emit }) =>
        () =>
          h(
            "section",
            {
              id: "list",
              "data-loading": String(props.loading),
              "data-error": String(props.hasError),
            },
            [
              h(
                "button",
                { id: "retry", onClick: () => emit("fetch-more-tokens") },
                "Retry"
              ),
              h(
                "button",
                {
                  id: "delete",
                  onClick: () =>
                    emit("delete-access-token", {
                      tokenId: token.id,
                      tokenLabel: token.label,
                    }),
                },
                "Delete"
              ),
              h("output", String(props.accessTokens.length)),
            ]
          ),
    })
  )
  app.component(
    "AccessTokensGenerateModal",
    defineComponent({
      props: ["accessToken", "tokenGenerateActionLoading"],
      emits: ["generate-access-token"],
      setup: (props, { emit }) => {
        const label = ref("My integration")
        return () =>
          h("section", { id: "generate" }, [
            h("input", {
              value: label.value,
              onInput: (event: Event) => {
                label.value = (event.target as HTMLInputElement).value
              },
            }),
            h(
              "button",
              {
                id: "submit",
                disabled: props.tokenGenerateActionLoading,
                onClick: () =>
                  emit("generate-access-token", {
                    label: label.value,
                    expiryInDays: 7,
                  }),
              },
              "Generate"
            ),
            h("output", props.accessToken),
          ])
      },
    })
  )
  app.component(
    "HoppSmartConfirmModal",
    defineComponent({
      props: ["show", "loadingState"],
      emits: ["resolve"],
      setup:
        (props, { emit }) =>
        () =>
          props.show
            ? h(
                "button",
                {
                  id: "confirm",
                  disabled: props.loadingState,
                  onClick: () => emit("resolve"),
                },
                "Confirm"
              )
            : null,
    })
  )
  app.mount(target)
  await nextTick()
  await vi.waitFor(() =>
    expect(target.querySelector("#list")?.getAttribute("data-loading")).toBe(
      "false"
    )
  )
}
const click = (selector: string) =>
  target.querySelector<HTMLButtonElement>(selector)!.click()

describe("access token failure recovery", () => {
  it("clears list loading and allows retry when authentication fails", async () => {
    mocks.ready.mockRejectedValueOnce(new Error("Session unavailable"))
    await mount()
    expect(target.querySelector("#list")?.getAttribute("data-error")).toBe(
      "true"
    )
    expect(mocks.get).not.toHaveBeenCalled()
    click("#retry")
    await vi.waitFor(() =>
      expect(target.querySelector("#list")?.getAttribute("data-error")).toBe(
        "false"
      )
    )
    expect(target.querySelector("#list output")?.textContent).toBe("1")
  })
  it.each(["request", "authentication"])(
    "keeps the token form and input after a %s failure, then retries",
    async (failure) => {
      await mount()
      if (failure === "request")
        mocks.post.mockRejectedValueOnce(new Error("Offline"))
      else mocks.ready.mockRejectedValueOnce(new Error("Session unavailable"))
      click("#open")
      await vi.waitFor(() =>
        expect(target.querySelector("#submit")).not.toBeNull()
      )
      click("#submit")
      await vi.waitFor(() =>
        expect(mocks.error).toHaveBeenCalledWith("error.generate_access_token")
      )
      expect(
        target.querySelector<HTMLInputElement>("#generate input")?.value
      ).toBe("My integration")
      expect(target.querySelector<HTMLButtonElement>("#submit")?.disabled).toBe(
        false
      )
      click("#submit")
      await vi.waitFor(() =>
        expect(target.querySelector("#generate output")?.textContent).toBe(
          "generated-token"
        )
      )
      expect(mocks.post).toHaveBeenLastCalledWith(
        expect.any(String),
        { label: "My integration", expiryInDays: 7 },
        {}
      )
    }
  )
  it("keeps a failed revoke confirmation available for retry", async () => {
    await mount()
    mocks.delete.mockRejectedValueOnce(new Error("Offline"))
    click("#delete")
    await vi.waitFor(() =>
      expect(target.querySelector("#confirm")).not.toBeNull()
    )
    click("#confirm")
    await vi.waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("error.delete_access_token")
    )
    expect(target.querySelector<HTMLButtonElement>("#confirm")?.disabled).toBe(
      false
    )
    expect(target.querySelector("#list output")?.textContent).toBe("1")
    click("#confirm")
    await vi.waitFor(() => expect(target.querySelector("#confirm")).toBeNull())
    expect(target.querySelector("#list output")?.textContent).toBe("0")
  })
})
