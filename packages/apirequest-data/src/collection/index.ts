import { InferredEntity, createVersionedEntity } from "verzod"

import V12_VERSION from "./v/12"

export { CollectionVariable } from "./v/10"

import { z } from "zod"
import { parseRESTRequest } from "../rest"
import { HoppRESTRequest } from "../rest"
import { parseGQLRequest } from "../graphql"
import { HoppGQLRequest } from "../graphql"
import { generateUniqueRefId } from "../utils/collection"

const versionedObject = z.object({
  v: z.number(),
})

export const HoppCollection = createVersionedEntity({
  latestVersion: 12,
  versionMap: { 12: V12_VERSION },
  getVersion(data) {
    const result = versionedObject.safeParse(data)
    return result.success ? result.data.v : null
  },
})

export type HoppCollection = InferredEntity<typeof HoppCollection>

export type HoppCollectionVariable = InferredEntity<
  typeof HoppCollection
>["variables"][number]

export const CollectionSchemaVersion = 12

/**
 * Generates a Collection object. This ignores the version number object
 * @param x The Collection Data
 * @returns The final collection
 */
export function makeCollection(x: Omit<HoppCollection, "v">): HoppCollection {
  return {
    v: CollectionSchemaVersion,
    ...x,
    _ref_id: x._ref_id ? x._ref_id : generateUniqueRefId("coll"),
  }
}

export function parseCollection(value: unknown): HoppCollection {
  const result = HoppCollection.safeParse(value)
  if (result.type !== "ok") throw new Error("Invalid current collection")
  return result.value
}

/**
 * Checks if a request object is a GraphQL request.
 * GQL requests have `query` and `url` fields but no `endpoint` field.
 * @param req The request object to check
 * @returns Whether the request is a HoppGQLRequest
 */
export function isGQLRequest(
  req: HoppRESTRequest | HoppGQLRequest
): req is HoppGQLRequest {
  // Object check first — callers pass raw persisted/imported JSON, and the
  // `in` operator throws on primitives
  return (
    !!req &&
    typeof req === "object" &&
    "query" in req &&
    "url" in req &&
    !("endpoint" in req)
  )
}

/**
 * Checks if a request object is a REST request.
 * REST requests have `endpoint` and `method` fields.
 * @param req The request object to check
 * @returns Whether the request is a HoppRESTRequest
 */
export function isRESTRequest(
  req: HoppRESTRequest | HoppGQLRequest
): req is HoppRESTRequest {
  // Object check first — callers pass raw persisted/imported JSON, and the
  // `in` operator throws on primitives
  return (
    !!req && typeof req === "object" && "endpoint" in req && "method" in req
  )
}
