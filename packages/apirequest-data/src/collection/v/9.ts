import { defineVersion, entityReference } from "verzod"
import { z } from "zod"

import { HoppGQLAuth } from "../../graphql/v/9"
import { HoppRESTAuth } from "../../rest/v/15/auth"

import { HoppCollection } from ".."
import { v8_baseCollectionSchema, V8_SCHEMA } from "./8"

export const v9_baseCollectionSchema = v8_baseCollectionSchema.extend({
  v: z.literal(9),
  auth: z.union([HoppRESTAuth, HoppGQLAuth]),
})

type Input = z.input<typeof v9_baseCollectionSchema> & {
  folders: Input[]
}

type Output = z.output<typeof v9_baseCollectionSchema> & {
  folders: Output[]
}

export const V9_SCHEMA = v9_baseCollectionSchema.extend({
  folders: z.lazy(() => z.array(V9_SCHEMA)),
}) as z.ZodType<Output, z.ZodTypeDef, Input>

export default defineVersion({ initial: true, schema: V9_SCHEMA })
