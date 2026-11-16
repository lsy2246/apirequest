import * as Eq from "fp-ts/Eq"
import * as S from "fp-ts/string"
import cloneDeep from "lodash/cloneDeep"
import { createVersionedEntity, InferredEntity } from "verzod"
import { z } from "zod"

import { lodashIsEqualEq, mapThenEq, undefinedEq } from "../utils/eq"

import { HoppRESTRequestVariables } from "./v/2"

import { HoppRESTHeaders, HoppRESTParams } from "./v/7"

import { HoppRESTReqBody } from "./v/10/body"

import { HoppRESTAuth } from "./v/15/auth"

import { HoppRESTRequestResponses } from "../rest-request-response"
import { generateUniqueRefId } from "../utils/collection"
import V17_VERSION, { HoppRESTCurlOptions } from "./v/17"

export * from "./content-types"

export {
  HoppRESTAuthBasic,
  HoppRESTAuthBearer,
  HoppRESTAuthInherit,
  HoppRESTAuthNone,
} from "./v/1"

export { HoppRESTRequestVariables } from "./v/2"

export { HoppRESTAuthAPIKey } from "./v/4"

export {
  HoppRESTAuthAWSSignature,
  HoppRESTHeaders,
  HoppRESTParams,
} from "./v/7"

export { HoppRESTAuthDigest } from "./v/8/auth"

export { FormDataKeyValue } from "./v/9/body"

export { HoppRESTReqBody } from "./v/10/body"

export { HoppRESTAuthHAWK, HoppRESTAuthAkamaiEdgeGrid } from "./v/12/auth"

export { HoppRESTAuth, HoppRESTAuthJWT } from "./v/15/auth"
export { AuthCodeGrantTypeParams } from "./v/15/auth"
export { PasswordGrantTypeParams } from "./v/15/auth"
export { ImplicitOauthFlowParams } from "./v/15/auth"
export {
  HoppRESTAuthOAuth2,
  ClientCredentialsGrantTypeParams,
  OAuth2AdvancedParam,
  OAuth2AuthRequestParam,
} from "./v/15/auth"

export {
  HoppRESTRequestResponse,
  HoppRESTRequestResponses,
} from "../rest-request-response"

const versionedObject = z.object({
  // v is a stringified number
  v: z.string().regex(/^\d+$/).transform(Number),
})

export const HoppRESTRequest = createVersionedEntity({
  latestVersion: 17,
  versionMap: { 17: V17_VERSION },
  getVersion(data) {
    const result = versionedObject.safeParse(data)
    return result.success ? result.data.v : null
  },
})

export type HoppRESTRequest = InferredEntity<typeof HoppRESTRequest>

// TODO: Handle the issue with the preRequestScript and testScript type check failures on pre-commit
const HoppRESTRequestEq = Eq.struct<HoppRESTRequest>({
  id: undefinedEq(S.Eq),
  v: S.Eq,
  auth: lodashIsEqualEq,
  body: lodashIsEqualEq,
  endpoint: S.Eq,
  headers: mapThenEq(
    (arr) => arr.filter((h: any) => h.key !== "" && h.value !== ""),
    lodashIsEqualEq
  ),
  params: mapThenEq(
    (arr) => arr.filter((p: any) => p.key !== "" && p.value !== ""),
    lodashIsEqualEq
  ),
  method: S.Eq,
  name: S.Eq,
  preRequestScript: S.Eq,
  testScript: S.Eq,
  requestVariables: mapThenEq(
    (arr) => arr.filter((v: any) => v.key !== "" && v.value !== ""),
    lodashIsEqualEq
  ),
  responses: lodashIsEqualEq,
  curlOptions: lodashIsEqualEq,
  queryEncoding: lodashIsEqualEq,
  _ref_id: undefinedEq(S.Eq),
  description: lodashIsEqualEq,
})

export const RESTReqSchemaVersion = "17"

export type HoppRESTParam = HoppRESTRequest["params"][number]
export type HoppRESTHeader = HoppRESTRequest["headers"][number]
export type HoppRESTRequestVariable =
  HoppRESTRequest["requestVariables"][number]

export const isEqualHoppRESTRequest = HoppRESTRequestEq.equals

export function makeRESTRequest(
  x: Omit<HoppRESTRequest, "v">
): HoppRESTRequest {
  return {
    v: RESTReqSchemaVersion,
    _ref_id: x._ref_id ?? generateUniqueRefId("req"),
    ...x,
  }
}

export function getDefaultRESTRequest(): HoppRESTRequest {
  const ref_id = generateUniqueRefId("req")
  return {
    v: RESTReqSchemaVersion,
    endpoint: "",
    name: "Untitled",
    params: [],
    headers: [],
    method: "GET",
    auth: {
      authType: "inherit",
      authActive: true,
    },
    preRequestScript: "",
    testScript: "",
    body: {
      contentType: null,
      body: null,
    },
    requestVariables: [],
    responses: {},
    _ref_id: ref_id,
    description: null,
  }
}

export function parseRESTRequest(value: unknown): HoppRESTRequest {
  const result = HoppRESTRequest.safeParse(value)
  if (result.type !== "ok") throw new Error("Invalid current REST request")
  return result.value
}
