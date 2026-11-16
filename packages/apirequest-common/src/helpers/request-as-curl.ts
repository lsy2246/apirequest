import type { HoppGQLRequest, HoppRESTRequest } from "@apirequest/data";
import * as O from "fp-ts/Option";
import { parse, type ParseError } from "jsonc-parser";
import { isRESTRequest } from "~/helpers/request-type";
import { generateCode } from "~/helpers/new-codegen";
import { getDefaultRESTRequest } from "~/helpers/rest/default";
import { getEffectiveRESTRequest, resolvesEnvsInBody } from "~/helpers/utils/EffectiveURL";
import { getEffectiveVariablesForRequest } from "~/helpers/utils/environments";
import { getAggregateEnvsWithCurrentValue } from "~/newstore/environments";

export async function requestAsCurl(request: HoppRESTRequest | HoppGQLRequest) {
  let rest: HoppRESTRequest
  if (isRESTRequest(request)) {
    rest = request
  } else {
    const errors: ParseError[] = []
    const variables = parse(request.variables.trim() || "{}", errors)
    if (errors.length) return ""
    rest = {
      ...getDefaultRESTRequest(),
      method: "POST",
      endpoint: request.url,
      headers: request.headers,
      auth: request.auth,
      body: {
        contentType: "application/json",
        body: JSON.stringify({ query: request.query, variables }),
      },
    }
  }

  const environment = {
    v: 2 as const,
    id: "share",
    name: "Share",
    variables: getEffectiveVariablesForRequest(
      rest.requestVariables,
      undefined,
      getAggregateEnvsWithCurrentValue(),
      false
    ),
  }
  const effective = await getEffectiveRESTRequest(rest, environment, true, true)
  const requestBody =
    rest.body.contentType &&
    typeof effective.effectiveFinalBody === "string" &&
    rest.body.contentType !== "multipart/form-data" &&
    rest.body.contentType !== "application/octet-stream" &&
    rest.body.contentType !== "application/x-www-form-urlencoded"
      ? { ...rest.body, body: effective.effectiveFinalBody }
      : resolvesEnvsInBody(rest.body, environment)
  return O.getOrElse(() => "")(
    generateCode("shell-curl", {
      ...rest,
      endpoint: effective.effectiveFinalURL,
      headers: effective.effectiveFinalHeaders,
      params: effective.effectiveFinalParams,
      body: requestBody,
    })
  )
}
