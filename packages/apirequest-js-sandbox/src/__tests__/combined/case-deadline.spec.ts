import { describe, expect, it } from "vitest"
import {
  getDefaultRESTRequest,
  runWithCaseDeadline,
  caseDeadline,
} from "@apirequest/data"
import type { HoppFetchHook } from "~/types"
import { runPreRequestScript as webPre } from "~/web/pre-request"
import { runTestScript as webPost } from "~/web/test-runner"
import { runPreRequestScript as nodePre } from "~/node/pre-request"
import { runTestScript as nodePost } from "~/node/test-runner"

const script = "const began = Date.now(); while (Date.now() - began < 3000) {}"
const request = getDefaultRESTRequest()
const envs = { global: [], selected: [], temp: [] }
const response = {
  status: 200,
  statusText: "OK",
  headers: [],
  body: "",
  responseTime: 0,
}
const targets = [
  {
    name: "web setup",
    run: (hook: HoppFetchHook) =>
      webPre(script, { request, envs, cookies: null, hoppFetchHook: hook }),
  },
  {
    name: "web assertions",
    run: (hook: HoppFetchHook) =>
      webPost(script, {
        request,
        envs,
        response,
        cookies: null,
        hoppFetchHook: hook,
      }),
  },
  {
    name: "node setup",
    run: (hook: HoppFetchHook) =>
      nodePre(script, { request, envs, cookies: null, hoppFetchHook: hook })(),
  },
  {
    name: "node assertions",
    run: (hook: HoppFetchHook) =>
      nodePost(script, {
        request,
        envs,
        response,
        cookies: null,
        hoppFetchHook: hook,
      })(),
  },
]

describe("case deadlines interrupt sandbox CPU execution", () => {
  for (const target of targets)
    it(target.name, async () => {
      const began = Date.now()
      await expect(
        runWithCaseDeadline(200, (signal) => {
          const hook: HoppFetchHook = async () => {
            throw new Error("No network expected")
          }
          hook.executionSignal = signal
          hook.executionDeadline = caseDeadline(signal)
          return target.run(hook)
        })
      ).rejects.toMatchObject({ code: "CASE_TIMEOUT", timeoutMs: 200 })
      expect(Date.now() - began).toBeLessThan(1500)
    })
})
