import { z } from "zod"

import { defineVersion } from "verzod"

import { HoppRESTAuthOAuth2 } from "../../rest/v/5"
import {
  HoppGQLAuthAPIKey as HoppGQLAuthAPIKeyOld,
  HoppGQLAuthBasic,
  HoppGQLAuthBearer,
  HoppGQLAuthInherit,
  HoppGQLAuthNone,
} from "./2"
import { V3_SCHEMA } from "./3"

export { HoppRESTAuthOAuth2 as HoppGQLAuthOAuth2 } from "../../rest/v/5"

export const HoppGQLAuthAPIKey = HoppGQLAuthAPIKeyOld.extend({
  addTo: z.enum(["HEADERS", "QUERY_PARAMS"]).catch("HEADERS"),
})

export type HoppGqlAuthOAuth2 = z.infer<typeof HoppRESTAuthOAuth2>

export const HoppGQLAuth = z
  .discriminatedUnion("authType", [
    HoppGQLAuthNone,
    HoppGQLAuthInherit,
    HoppGQLAuthBasic,
    HoppGQLAuthBearer,
    HoppGQLAuthAPIKey,
    HoppRESTAuthOAuth2, // both rest and gql have the same auth type for oauth2
  ])
  .and(
    z.object({
      authActive: z.boolean(),
    })
  )

export type HoppGQLAuth = z.infer<typeof HoppGQLAuth>

export const V4_SCHEMA = V3_SCHEMA.extend({
  v: z.literal(4),
  auth: HoppGQLAuth,
})

export default defineVersion({ initial: true, schema: V4_SCHEMA })
