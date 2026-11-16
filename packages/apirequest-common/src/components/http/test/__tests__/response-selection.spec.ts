import { afterEach, describe, expect, it, vi } from "vitest"
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue"
import Response from "../Response.vue"
import { getDefaultRESTRequest } from "@apirequest/data"
import type { TestRunnerRequest } from "~/services/test-runner/test-runner.service"
import { emptyRunnerTestResult } from "~/helpers/test-runner/report"
vi.mock("~/composables/i18n", () => ({ useI18n: () => (key: string) => key }))
vi.mock("~/composables/theming", () => ({
  useColorMode: () => ({ value: { value: "light" } }),
}))
let app: App | undefined
afterEach(() => app?.unmount())
const request = (
  name: string,
  statusCode: number,
  body: string
): TestRunnerRequest => {
  const req = { ...getDefaultRESTRequest(), name }
  return {
    ...req,
    type: "test-response",
    passedTests: 0,
    failedTests: 0,
    testResults: emptyRunnerTestResult(),
    response: {
      type: "success",
      req,
      statusCode,
      statusText: "fixture",
      headers: [],
      body: new TextEncoder().encode(body).buffer as ArrayBuffer,
      meta: { responseDuration: statusCode, responseSize: body.length },
    },
  }
}
describe("selected runner response", () => {
  it("updates the response status, body and request label together when the selection changes", async () => {
    const selected = ref(request("Missing", 404, '{"error":"missing"}'))
    const target = document.createElement("div")
    app = createApp({
      render: () =>
        h(Response, {
          document: selected.value,
          showResponse: true,
          tabId: "fixture",
        }),
    })
    app.component(
      "HttpResponseMeta",
      defineComponent({
        props: ["response"],
        setup: (props) => () =>
          h("span", { class: "status" }, String(props.response.statusCode)),
      })
    )
    app.component(
      "LensesResponseBodyRenderer",
      defineComponent({
        props: ["document"],
        setup: (props) => () =>
          h("pre", new TextDecoder().decode(props.document.response.body)),
      })
    )
    app.mount(target)
    expect(target.textContent).toContain("Missing404")
    expect(target.querySelector("pre")!.textContent).toBe('{"error":"missing"}')
    selected.value = request("Created", 201, '{"id":7}')
    await nextTick()
    expect(target.querySelector(".status")!.textContent).toBe("201")
    expect(target.querySelector("pre")!.textContent).toBe('{"id":7}')
    expect(
      target.querySelector('[data-testid="selected-run-request"]')!.textContent
    ).toBe("Created")
    expect(target.textContent).not.toContain("Missing")
  })
})
