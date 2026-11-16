import { InferredEntity, createVersionedEntity } from "verzod"
import { z } from "zod"
import { generateUniqueRefId } from "../utils/collection"

import V10_VERSION from "./v/10"

export {
  HoppGQLAuthBasic,
  HoppGQLAuthBearer,
  HoppGQLAuthInherit,
  HoppGQLAuthNone,
} from "./v/2"

export { HoppGQLAuthAPIKey } from "./v/4"

export { GQLHeader, HoppGQLAuthAWSSignature } from "./v/6"
export { HoppGQLAuth, HoppGQLAuthOAuth2 } from "./v/9"

export const GQL_REQ_SCHEMA_VERSION = 10

const versionedObject = z.object({
  v: z.number(),
})

export const HoppGQLRequest = createVersionedEntity({
  latestVersion: 10,
  versionMap: { 10: V10_VERSION },
  getVersion(data) {
    const result = versionedObject.safeParse(data)
    return result.success ? result.data.v : null
  },
})

export type HoppGQLRequest = InferredEntity<typeof HoppGQLRequest>

export function getDefaultGQLRequest(): HoppGQLRequest {
  return {
    v: GQL_REQ_SCHEMA_VERSION,
    name: "Untitled",
    url: "",
    headers: [],
    variables: "{}",
    query: "",
    auth: {
      authType: "inherit",
      authActive: true,
    },
    _ref_id: generateUniqueRefId("req"),
    description: null,
    responses: {},
    preRequestScript: "",
    testScript: "",
  }
}

/**
 * @deprecated This function is deprecated. Use `HoppGQLRequest` instead.
 */
export function parseGQLRequest(value: unknown): HoppGQLRequest {
  const result = HoppGQLRequest.safeParse(value)
  if (result.type !== "ok") throw new Error("Invalid current GraphQL request")
  return result.value
}

export function makeGQLRequest(x: Omit<HoppGQLRequest, "v">): HoppGQLRequest {
  return {
    v: GQL_REQ_SCHEMA_VERSION,
    ...x,
  }
}
