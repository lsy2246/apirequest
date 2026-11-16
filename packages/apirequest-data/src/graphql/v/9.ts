import { defineVersion } from "verzod"
import { z } from "zod"

import {
  HoppGQLAuthBasic,
  HoppGQLAuthBearer,
  HoppGQLAuthInherit,
  HoppGQLAuthNone,
} from "./2"
import { HoppGQLAuthAPIKey } from "./4"
import { HoppGQLAuthAWSSignature } from "./6"
import { HoppRESTAuthOAuth2 } from "../../rest/v/15/auth"
import { V8_SCHEMA } from "./8"

export { HoppRESTAuthOAuth2 as HoppGQLAuthOAuth2 } from "../../rest/v/15/auth"

export const HoppGQLAuth = z
  .discriminatedUnion("authType", [
    HoppGQLAuthNone,
    HoppGQLAuthInherit,
    HoppGQLAuthBasic,
    HoppGQLAuthBearer,
    HoppRESTAuthOAuth2,
    HoppGQLAuthAPIKey,
    HoppGQLAuthAWSSignature,
  ])
  .and(
    z.object({
      authActive: z.boolean(),
    })
  )

export type HoppGQLAuth = z.infer<typeof HoppGQLAuth>

export const V9_SCHEMA = V8_SCHEMA.extend({
  v: z.literal(9),
  auth: HoppGQLAuth,
})

export default defineVersion({ initial: true, schema: V9_SCHEMA })
