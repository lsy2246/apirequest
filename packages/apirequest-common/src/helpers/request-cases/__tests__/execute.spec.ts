import { beforeEach, describe, expect, it, vi } from "vitest"
import { getDefaultRESTRequest } from "@apirequest/data"
import * as E from "fp-ts/Either"
vi.mock("~/modules/dioc", () => ({ getService: vi.fn() }))
vi.mock("~/services/cookie-jar.service", () => ({ CookieJarService: class {} }))
vi.mock("~/platform", () => ({
  platform: { platformFeatureFlags: { cookiesEnabled: false } },
}))
const mocks = vi.hoisted(() => ({
  pre: vi.fn(),
  post: vi.fn(),
  effective: vi.fn(),
  toRequest: vi.fn(),
}))
vi.mock("~/helpers/RequestRunner", () => ({
  captureInitialEnvironmentState: () => ({
    initialEnvs: {
      global: [],
      selected: [
        {
          key: "empty",
          initialValue: "fallback",
          currentValue: "fallback",
          secret: false,
        },
      ],
      temp: [],
    },
  }),
  combineEnvVariables: ({ environments, requestVariables }: any) => [
    ...requestVariables,
    ...environments.selected,
    ...environments.global,
  ],
  delegatePreRequestScriptRunner: mocks.pre,
  runPostRequestScript: mocks.post,
}))
vi.mock("../environments", () => ({
  caseEnvironmentState: () => ({
    global: [],
    selected: [
      {
        key: "empty",
        initialValue: "fallback",
        currentValue: "fallback",
        secret: false,
      },
    ],
    temp: [],
  }),
}))
vi.mock("~/helpers/experimental-sandbox-integration", () => ({
  applyScriptRequestUpdates: (request: unknown) => request,
}))
vi.mock("~/helpers/utils/inheritedCollectionVarTransformer", () => ({
  transformInheritedCollectionVariablesToAggregateEnv: () => [],
}))
vi.mock("~/helpers/utils/EffectiveURL", () => ({
  getEffectiveRESTRequest: mocks.effective,
}))
vi.mock("~/helpers/kernel/rest/request", () => ({
  RESTRequest: { toRequest: mocks.toRequest },
}))
import { executeRequestCase } from "../execute"
import { newRequestCase } from "../model"
const initial = () => ({ global: [], selected: [], temp: [] })
const network = () =>
  E.right({
    status: 200,
    headers: { "content-type": "application/json" },
    body: { body: new TextEncoder().encode('{"code":0}') },
    meta: { timing: { start: 10, end: 30 } },
  })
beforeEach(() => {
  vi.clearAllMocks()
  mocks.pre.mockResolvedValue(E.right({ updatedEnvs: initial() }))
  mocks.post.mockResolvedValue(
    E.right({ tests: { descriptor: "root", expectResults: [], children: [] } })
  )
  mocks.effective.mockImplementation(async (request: any) => ({
    ...request,
    effectiveFinalURL: request.endpoint,
  }))
  mocks.toRequest.mockImplementation(async (request: any) => ({
    url: request.endpoint,
    method: request.method,
  }))
})
describe("case execution", () => {
  it("checks a full response, inherits scripts and preserves an explicitly empty variable", async () => {
    const entry = newRequestCase()
    entry.variables = { empty: "" }
    const base = getDefaultRESTRequest()
    base.endpoint = "http://example.test"
    base.preRequestScript = "before"
    base.testScript = "after"
    const inherited = {
      headers: [],
      variables: [],
      scripts: [
        { preRequestScript: "parent before", testScript: "parent after" },
      ],
    } as any
    const execute = vi.fn(() => ({
      cancel: vi.fn(),
      response: Promise.resolve(network()),
    }))
    const result = await executeRequestCase(
      base,
      entry,
      inherited,
      { execute } as any,
      new AbortController().signal
    )
    expect(result).toMatchObject({
      status: 200,
      duration: 20,
      assertions: [{ passed: true }],
    })
    expect(mocks.pre.mock.calls[0][3]).toEqual(["parent before"])
    expect(mocks.post.mock.calls[0][4]).toEqual(["parent after"])
    expect(
      mocks.effective.mock.calls[0][1].variables.find(
        (v: any) => v.key === "empty"
      ).currentValue
    ).toBe("")
  })
  it("skips all parent scripts when disabled, and includes failed script assertions in results", async () => {
    const entry = newRequestCase()
    entry.scripts = "disabled"
    mocks.post.mockResolvedValue(
      E.right({
        tests: {
          descriptor: "root",
          expectResults: [],
          children: [
            {
              descriptor: "business code",
              expectResults: [{ status: "fail", message: "wrong code" }],
              children: [],
            },
          ],
        },
      })
    )
    const execute = () => ({
      cancel: vi.fn(),
      response: Promise.resolve(network()),
    })
    const result = await executeRequestCase(
      getDefaultRESTRequest(),
      entry,
      {
        headers: [],
        variables: [],
        scripts: [{ preRequestScript: "parent", testScript: "parent" }],
      } as any,
      { execute } as any,
      new AbortController().signal
    )
    expect(mocks.pre.mock.calls[0][0].preRequestScript).toBe("")
    expect(mocks.pre.mock.calls[0][3]).toEqual([])
    expect(result.scripts).toEqual([
      { name: "business code", passed: false, message: "wrong code" },
    ])
  })
  it("reports pre-script errors before making a network request", async () => {
    mocks.pre.mockResolvedValue(E.left("bad script"))
    const execute = vi.fn()
    await expect(
      executeRequestCase(
        getDefaultRESTRequest(),
        newRequestCase(),
        undefined,
        { execute } as any,
        new AbortController().signal
      )
    ).rejects.toThrow("case_pre_script_failed:bad script")
    expect(execute).not.toHaveBeenCalled()
  })
  it("treats an expected 401 as a response assertion and disables cookie auth", async () => {
    const entry = newRequestCase()
    entry.overrides.auth = "none"
    entry.assertions[0].expected = "401"
    const unauthorized = network()
    if (E.isRight(unauthorized)) unauthorized.right.status = 401
    const execute = vi.fn(() => ({
      cancel: vi.fn(),
      response: Promise.resolve(unauthorized),
    }))
    const result = await executeRequestCase(
      getDefaultRESTRequest(),
      entry,
      undefined,
      { execute } as any,
      new AbortController().signal
    )
    expect(result).toMatchObject({
      status: 401,
      assertions: [{ passed: true }],
    })
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          options: expect.objectContaining({ cookies: false }),
        }),
      })
    )
  })
  it("cancels an in-flight request without waiting for its response", async () => {
    const cancel = vi.fn(),
      execute = vi.fn(() => ({ cancel, response: new Promise(() => {}) })),
      controller = new AbortController()
    const promise = executeRequestCase(
      getDefaultRESTRequest(),
      newRequestCase(),
      undefined,
      { execute } as any,
      controller.signal
    )
    await vi.waitFor(() => expect(execute).toHaveBeenCalled())
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    expect(cancel).toHaveBeenCalledOnce()
  })
  it("does not start a request when cancelled during script preparation", async () => {
    let finish: any
    mocks.pre.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const execute = vi.fn(),
      controller = new AbortController()
    const promise = executeRequestCase(
      getDefaultRESTRequest(),
      newRequestCase(),
      undefined,
      { execute } as any,
      controller.signal
    )
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: "AbortError" })
    finish(E.right({ updatedEnvs: initial() }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(execute).not.toHaveBeenCalled()
  })
})
