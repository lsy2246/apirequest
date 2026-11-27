import { localRelayStatus } from "~/helpers/request-feedback"
import { cloneDeep } from "lodash-es";
import * as E from "fp-ts/Either";
import type { HoppRESTRequest } from "@apirequest/data";
import type { KernelInterceptorService } from "~/services/kernel-interceptor.service";
import type { HoppInheritedProperty } from "~/helpers/types/HoppInheritedProperties";
import { RESTRequest } from "~/helpers/kernel/rest/request";
import { getEffectiveRESTRequest } from "~/helpers/utils/EffectiveURL";
import { getEffectiveVariablesForRequest, filterNonEmptyEnvironmentVariables } from "~/helpers/utils/environments";
import { getAggregateEnvsWithCurrentValue } from "~/newstore/environments";
import { LoadTestRunner, LoadTestServiceLimitError, LoadTestTimeoutError } from "./runner";

export async function prepareLoadTest(
  request: HoppRESTRequest,
  inherited: HoppInheritedProperty | undefined,
  interceptor: KernelInterceptorService
) {
  // 冻结本次压测的鉴权、继承头和环境；运行时编辑原请求不影响已确认的目标。
  const snapshot = cloneDeep(request)
  if (snapshot.auth.authType === "inherit" && inherited?.auth)
    snapshot.auth = cloneDeep(
      inherited.auth.inheritedAuth
    ) as HoppRESTRequest["auth"]
  snapshot.headers = [
    ...(inherited?.headers.map((item) => ({ ...item.inheritedHeader })) ?? []),
    ...snapshot.headers,
  ]
  const variables = filterNonEmptyEnvironmentVariables(
    getEffectiveVariablesForRequest(
      snapshot.requestVariables,
      inherited?.variables,
      getAggregateEnvsWithCurrentValue()
    )
  )
  const effective = await getEffectiveRESTRequest(
    snapshot,
    { id: "load-test", name: "Load test", v: 2, variables },
    true
  )
  const target = new URL(effective.effectiveFinalURL)
  if (!["http:", "https:"].includes(target.protocol))
    throw new Error("Only HTTP and HTTPS requests can be load tested")
  const template = await RESTRequest.toRequest(effective)
  const runner = new LoadTestRunner((id, timeoutMs) => {
    const execution = interceptor.execute({
      ...cloneDeep(template),
      id,
      meta: {
        ...template.meta,
        options: {
          ...template.meta?.options,
          timeout: timeoutMs,
          cache: "no-store",
        },
      },
    })
    return {
      cancel: execution.cancel,
      response: execution.response.then((result) => {
        if (E.isLeft(result)) {
          const error = result.left.error
          if (error.kind === "timeout")
            throw new LoadTestTimeoutError("Request timed out")
          const status = localRelayStatus(error)
          if (status === 429 || status === 503) throw new LoadTestServiceLimitError(status)
          throw new Error("Network request failed")
        }
        const response = result.right
        return {
          status: response.status,
          durationMs: response.meta.timing.end - response.meta.timing.start,
          bytes: response.body?.body?.byteLength ?? 0,
        }
      }),
    }
  })
  return { runner, target: target.origin, method: snapshot.method }
}
