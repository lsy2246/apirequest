import { cloneDeep } from "lodash-es"
import * as E from "fp-ts/Either"
import {
  DEFAULT_CASE_TIMEOUT_MS,
  runWithCaseDeadline,
  type HoppRESTRequest,
} from "@apirequest/data"
import type { KernelInterceptorService } from "~/services/kernel-interceptor.service"
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties"
import {
  combineEnvVariables,
  delegatePreRequestScriptRunner,
  runPostRequestScript,
} from "~/helpers/RequestRunner"
import { applyScriptRequestUpdates } from "~/helpers/experimental-sandbox-integration"
import { transformInheritedCollectionVariablesToAggregateEnv } from "~/helpers/utils/inheritedCollectionVarTransformer"
import { getEffectiveRESTRequest } from "~/helpers/utils/EffectiveURL"
import { RESTRequest } from "~/helpers/kernel/rest/request"
import { getService } from "~/modules/dioc"
import { CookieJarService } from "~/services/cookie-jar.service"
import { platform } from "~/platform"
import { caseEnvironmentState } from "./environments"
import {
  buildCaseRequest,
  evaluateAssertions,
  type RequestCase,
  type AssertionResult,
} from "./model"

export type CaseRunResult = {
  status: number
  duration: number
  assertions: AssertionResult[]
  scripts: { name: string; passed: boolean; message: string }[]
  scriptError?: string
  response?: import("~/helpers/types/HoppRESTResponse").HoppRESTResponse
}
type ScriptTest = {
  descriptor: string
  expectResults: { status: "pass" | "fail" | "error"; message: string }[]
  children: ScriptTest[]
}

export async function executeRequestCase(
  base: HoppRESTRequest,
  entry: RequestCase,
  inherited: HoppInheritedProperty | undefined,
  interceptor: KernelInterceptorService,
  parentSignal: AbortSignal,
  options: {
    executeScripts?: boolean
    variables?: Record<string, string>
    environment?: ReturnType<typeof caseEnvironmentState>
  } = {}
): Promise<CaseRunResult> {
  const timeoutMs = entry.timeoutMs ?? DEFAULT_CASE_TIMEOUT_MS
  return runWithCaseDeadline(
    timeoutMs,
    async (signal) => {
      const started = Date.now()
      let cancel: (() => unknown) | undefined
      let rejectAbort: (reason: unknown) => void = () => {}
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject
      })
      const onAbort = () => {
        void cancel?.()
        rejectAbort(
          signal.reason ?? new DOMException("Cancelled", "AbortError")
        )
      }
      signal.addEventListener("abort", onAbort, { once: true })
      const run = async () => {
        signal.throwIfAborted()
        const definition =
          options.executeScripts === false
            ? { ...entry, scripts: "disabled" as const }
            : entry
        const request = buildCaseRequest(base, definition, inherited)
        const initial =
          entry.environmentID === undefined && options.environment
            ? cloneDeep(options.environment)
            : caseEnvironmentState(entry.environmentID)
        const caseVariables = Object.entries({
          ...options.variables,
          ...entry.variables,
        }).map(([key, value]) => ({
          key,
          initialValue: value,
          currentValue: value,
          secret: false,
        }))
        initial.selected = [
          ...caseVariables,
          ...initial.selected.filter(
            ({ key }: { key: string }) =>
              !caseVariables.some((value) => value.key === key)
          ),
        ]
        const inheritedScripts =
          definition.scripts === "inherit" ? (inherited?.scripts ?? []) : []
        const cookies =
          platform.platformFeatureFlags.cookiesEnabled &&
          entry.overrides.auth !== "none"
            ? cloneDeep(
                Array.from(
                  getService(CookieJarService).cookieJar.value.values()
                ).flat()
              )
            : null
        const pre = await delegatePreRequestScriptRunner(
          request,
          initial,
          cookies,
          inheritedScripts.map((script) => script.preRequestScript),
          signal
        )
        signal.throwIfAborted()
        if (E.isLeft(pre)) throw new Error(`case_pre_script_failed:${pre.left}`)
        const finalRequest = applyScriptRequestUpdates(
          request,
          pre.right.updatedRequest
        )
        const variables = combineEnvVariables({
          environments: pre.right.updatedEnvs,
          requestVariables: finalRequest.requestVariables
            .filter((item) => item.active)
            .map(({ key, value }) => ({
              key,
              initialValue: value,
              currentValue: value,
              secret: false,
            })),
          collectionVariables:
            transformInheritedCollectionVariablesToAggregateEnv(
              inherited?.variables ?? []
            ),
        })
        // 空字符串是有效测试输入，不回退到环境中的同名非空值。
        const effectiveVariables = [
          ...new Map(
            variables
              .slice()
              .reverse()
              .map((variable) => [variable.key, variable])
          ).values(),
        ]
        const effective = await getEffectiveRESTRequest(finalRequest, {
          id: "request-case",
          name: entry.name,
          v: 2,
          variables: effectiveVariables,
        })
        if (
          !["http:", "https:"].includes(
            new URL(effective.effectiveFinalURL).protocol
          )
        )
          throw new Error("case_invalid_url")
        const template = await RESTRequest.toRequest(effective)
        signal.throwIfAborted()
        const execution = interceptor.execute({
          ...template,
          meta: {
            ...template.meta,
            options: {
              ...template.meta?.options,
              timeout: Math.max(1, timeoutMs - (Date.now() - started)),
              cache: "no-store",
              ...(entry.overrides.auth === "none" ||
              entry.overrides.headers.some(
                (header) =>
                  header.remove && header.key.toLowerCase() === "cookie"
              )
                ? { cookies: false }
                : {}),
            },
          },
        })
        cancel = execution.cancel
        const network = await execution.response
        signal.throwIfAborted()
        if (E.isLeft(network)) throw network.left
        const response = network.right
        const body = new TextDecoder().decode(response.body.body)
        const duration = Math.max(
          0,
          (response.meta?.timing?.end ?? 0) -
            (response.meta?.timing?.start ?? 0)
        )
        const result: CaseRunResult = {
          status: response.status,
          duration,
          assertions: evaluateAssertions(entry.assertions, {
            status: response.status,
            headers: response.headers ?? {},
            body,
            duration,
          }),
          scripts: [],
          response: {
            type: response.status >= 400 ? "fail" : "success",
            statusCode: response.status,
            statusText: response.statusText ?? "",
            headers: Object.entries(response.headers ?? {}).map(
              ([key, value]) => ({
                key,
                value: String(value),
              })
            ),
            body: new Uint8Array(response.body.body).buffer,
            meta: {
              responseDuration: duration,
              responseSize: response.body.body.byteLength,
            },
            req: finalRequest,
          },
        }
        let testBody: unknown = body
        try {
          testBody = JSON.parse(body)
        } catch {
          /* Text/file responses remain text. */
        }
        const post = await runPostRequestScript(
          pre.right.updatedEnvs,
          finalRequest,
          {
            status: response.status,
            body: testBody,
            headers: Object.entries(response.headers ?? {}).map(
              ([key, value]) => ({
                key,
                value: String(value),
              })
            ),
            statusText: response.statusText ?? "",
            responseTime: duration,
          } as unknown as Parameters<typeof runPostRequestScript>[2],
          pre.right.updatedCookies ?? null,
          inheritedScripts.map((script) => script.testScript),
          signal
        )
        signal.throwIfAborted()
        if (E.isLeft(post)) result.scriptError = post.left
        else {
          const collect = (test: ScriptTest, path = "") => {
            const name = [
              path,
              test.descriptor === "root" ? "" : test.descriptor,
            ]
              .filter(Boolean)
              .join(" / ")
            result.scripts.push(
              ...test.expectResults.map((item) => ({
                name,
                passed: item.status === "pass",
                message: item.message,
              }))
            )
            test.children.forEach((child) => collect(child, name))
          }
          collect(post.right.tests)
        }
        return result
      }
      try {
        return await Promise.race([run(), aborted])
      } finally {
        signal.removeEventListener("abort", onAbort)
      }
    },
    parentSignal
  )
}
