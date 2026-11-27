import {
  makeHoppGQLResponseOriginalRequest,
  makeHoppRESTResponseOriginalRequest,
  type HoppGQLRequest,
  type HoppGQLRequestResponse,
  type HoppRESTRequest,
  type HoppRESTRequestResponse,
} from "@apirequest/data"
import { getResponseBodyText } from "~/composables/lens-actions"
import type { HoppRESTResponse } from "~/helpers/types/HoppRESTResponse"
import { getStatusCodeReasonPhrase } from "~/helpers/utils/statusCodes"
import type { GQLResponseEvent } from "~/services/gql-tab-connection.service"
import type { HoppGQLRequestDocument, HoppRequestDocument } from "./document"

// 用固定键更新自动保存的响应，切换语言或修改请求名称都不会另建一份。
export const LATEST_RESPONSE_NAME = "__workbench_latest_response__"

export function makeRESTResponseExample(
  name: string,
  response: Extract<HoppRESTResponse, { type: "success" | "fail" }>,
  body = getResponseBodyText(response.body),
  request = response.req
): HoppRESTRequestResponse {
  const {
    name: requestName,
    method,
    endpoint,
    headers,
    auth,
    params,
    requestVariables,
  } = request
  return {
    name,
    status: getStatusCodeReasonPhrase(response.statusCode, response.statusText),
    code: response.statusCode,
    headers: response.headers,
    body,
    originalRequest: makeHoppRESTResponseOriginalRequest({
      name: requestName,
      method,
      endpoint,
      headers,
      body: request.body,
      auth,
      params,
      requestVariables,
    }),
  }
}

export function makeGQLResponseExample(
  name: string,
  request: HoppGQLRequest,
  event: Extract<GQLResponseEvent, { type: "response" }>
): HoppGQLRequestResponse {
  const { url, query, variables, headers, auth } = request
  return {
    name,
    originalRequest: makeHoppGQLResponseOriginalRequest({
      name: request.name,
      url,
      query,
      variables,
      headers,
      auth,
    }),
    status: event.document?.statusText ?? "",
    code: event.document?.statusCode ?? null,
    // GraphQL 的响应事件目前只提供状态和正文。
    headers: [],
    body: event.data,
    operationName: event.operationName,
    operationType: event.operationType,
  }
}

export function requestWithLatestRESTResponse(
  document: HoppRequestDocument
): HoppRESTRequest {
  const { request, response } = document
  if (
    !response ||
    (response.type !== "success" && response.type !== "fail") ||
    !response.body.byteLength
  )
    return request

  let body: string
  try {
    // 现有示例以文本存储。无法无损解码的正文继续由调试面板下载。
    body = getResponseBodyText(response.body, { fatal: true })
  } catch {
    return request
  }
  if (!body || body.includes("\0")) return request

  // 自动保存引用编辑器的请求配置，避免把脚本注入的运行时参数复制进示例。
  return {
    ...request,
    responses: {
      ...request.responses,
      [LATEST_RESPONSE_NAME]: makeRESTResponseExample(
        LATEST_RESPONSE_NAME,
        response,
        body,
        request
      ),
    },
  }
}

export function requestWithLatestGQLResponse(
  document: HoppGQLRequestDocument
): HoppGQLRequest {
  const { request, response } = document
  const event = response?.at(-1)
  if (event?.type !== "response" || !event.data) return request

  return {
    ...request,
    responses: {
      ...request.responses,
      [LATEST_RESPONSE_NAME]: makeGQLResponseExample(
        LATEST_RESPONSE_NAME,
        request,
        event
      ),
    },
  }
}
