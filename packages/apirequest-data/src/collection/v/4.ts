import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppGQLAuth } from "../../graphql/v/7"
import { HoppRESTAuth } from "../../rest/v/8/auth"

import { V3_SCHEMA, v3_baseCollectionSchema } from "./3"
import { HoppCollection } from ".."

export const v4_baseCollectionSchema = v3_baseCollectionSchema.extend({
  v: z.literal(4),
  auth: z.union([HoppRESTAuth, HoppGQLAuth]),
})

type Input = z.input<typeof v4_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v4_baseCollectionSchema> & {
  folders: Output[]
}

export const V4_SCHEMA = v4_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V4_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V4_SCHEMA })
