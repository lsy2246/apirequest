import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { GQLHeader as V1_GQLHeader } from "../../graphql/v/1"
import { HoppRESTHeaders as V1_HoppRESTHeaders } from "../../rest/v/1"

import { HoppGQLAuth, GQLHeader as V2_GQLHeader } from "../../graphql/v/6"
import {
  HoppRESTAuth,
  HoppRESTHeaders as V2_HoppRESTHeaders,
} from "../../rest/v/7"

import { v2_baseCollectionSchema, V2_SCHEMA } from "./2"
import { HoppCollection } from ".."

export const v3_baseCollectionSchema = v2_baseCollectionSchema.extend({
  v: z.literal(3),

  // AWS Signature Authorization type addition
  auth: z.union([HoppRESTAuth, HoppGQLAuth]),

  // `description` field addition under `headers`
  headers: z.union([V2_HoppRESTHeaders, z.array(V2_GQLHeader)]),
})

type Input = z.input<typeof v3_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v3_baseCollectionSchema> & {
  folders: Output[]
}

export const V3_SCHEMA = v3_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V3_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V3_SCHEMA })
