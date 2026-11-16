import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppGQLAuth } from "../../graphql/v/8"
import { HoppRESTAuth } from "../../rest/v/11/auth"

import { V5_SCHEMA, v5_baseCollectionSchema } from "./5"
import { HoppCollection } from ".."

export const v6_baseCollectionSchema = v5_baseCollectionSchema.extend({
  v: z.literal(6),
  auth: z.union([HoppRESTAuth, HoppGQLAuth]),
})

type Input = z.input<typeof v6_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v6_baseCollectionSchema> & {
  folders: Output[]
}

export const V6_SCHEMA = v6_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V6_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V6_SCHEMA })
